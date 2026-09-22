import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { register as regShortcut, isRegistered as isReg, unregister as unreg } from "@tauri-apps/plugin-global-shortcut";
import { useEngineStore } from "./stores/engineStore";
import { TitleBar } from "./components/TitleBar";
import { StatusBar } from "./components/StatusBar";
import { EngineLauncher } from "./components/EngineLauncher";
import { CloseDialog } from "./components/CloseDialog";
import { KeyManagerDialog } from "./components/KeyManagerDialog";
import { findExistingInstanceInfo, waitEngineBusinessReady, onEngineHealth, stopEngine, loadVerifiedVersions, restartEngineOnPort, getEnginePort } from "./lib/dshEngine";
import { buildEngineAuth, readBrowserSessionSecret } from "./lib/engineAuth";
import { useZoomShortcuts } from "./hooks/useZoomShortcuts";

/**
 * DSH Desktop：Tauri 壳 + 官方 WebUI
 * - 壳：窗口控制 / 底部状态栏 / 引擎管理（引擎启动前展示）
 * - 引擎就绪后：主窗口整体导航到官方 dsh web（顶层文档，见下方 effect）
 * 官方 UI 自带完整侧栏（会话/设置/插件），无需自研侧栏。
 */
export default function App() {
  const health = useEngineStore((s) => s.health);
  const setHealth = useEngineStore((s) => s.setHealth);
  const launchRequested = useEngineStore((s) => s.launchRequested);
  const { zoom, setZoom } = useZoomShortcuts();
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const appWindow = getCurrentWindow();
  /** 管理模式：从托盘「打开管理界面」进入（URL 带 ?manage=1）。
   *  引擎运行中窗口会自动跳转引擎页，壳的升级/密钥/状态栏入口不可见；
   *  管理模式暂停该跳转，方便使用升级 / 回滚 / 清理 / 密钥等功能。
   *  托盘「重启引擎」（?restart=1）语义相同 —— 重启期间引擎会短暂变 starting，
   *  不暂停跳转的话窗口会在端口就绪前被抢走、重启反馈看不见 —— 故一并计入，
   *  这样首帧就是管理模式，不会先闪一下启动页。 */
  const [manageMode, setManageMode] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.has("manage") || sp.has("restart");
  });

  // 托盘「重启引擎」：引擎运行中时窗口显示的是引擎页、壳自己的重启入口不可见，
  // 所以由 Rust 侧导航回壳并带 `?restart=1&port=<端口>` 标记，这里执行真正的重启。
  // 标记必须在挂载时**读一次就清掉**：留着的话用户之后手动刷新页面（引擎刚起来、
  // 壳里已无重启意图）会平白再重启一次引擎。
  const pendingRestartRef = useRef<number | null>(null);
  const restartIntent = useRef(
    (() => {
      const sp = new URLSearchParams(window.location.search);
      if (!sp.has("restart")) return null;
      const p = Number(sp.get("port"));
      return Number.isInteger(p) && p > 0 && p <= 65535 ? p : 0;
    })(),
  );
  /** 托盘重启进行中的提示（重启链路可能耗时较久：首次 heals profiles 可达数分钟） */
  const [trayRestarting, setTrayRestarting] = useState(restartIntent.current !== null);

  // 标记读进内存后立刻从 URL 抹掉（replace，不留历史记录）。
  // manageMode 上面已按同一标记初始化，故这里只负责清地址栏。
  useEffect(() => {
    if (restartIntent.current === null) return;
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      /* ignore */
    }
  }, []);

  // ── 沉浸模式：隐藏桌面壳的标题栏/状态栏，让内嵌 WebUI 占满窗口 ──
  const [immersive, setImmersive] = useState<boolean>(() => {
    try {
      return localStorage.getItem("dsh-desktop-immersive") === "1";
    } catch {
      return false;
    }
  });
  /** 鼠标贴到窗口边缘时临时唤出被隐藏的栏 */
  const [peek, setPeek] = useState(false);
  /** 进入沉浸模式时的一次性提示 */
  const [showImmersiveHint, setShowImmersiveHint] = useState(false);
  const peekTimerRef = useRef<number | undefined>(undefined);

  const toggleImmersive = useCallback(() => {
    setImmersive((cur) => {
      const next = !cur;
      try {
        localStorage.setItem("dsh-desktop-immersive", next ? "1" : "0");
      } catch {
        /* localStorage 不可用时仅本次会话生效 */
      }
      if (next) {
        setShowImmersiveHint(true);
        window.setTimeout(() => setShowImmersiveHint(false), 3200);
      }
      return next;
    });
  }, []);

  // F12 开发者调试开关：仅在本窗口聚焦时注册全局快捷键，失焦即注销，
  // 避免抢占其他软件的 F12（与缩放快捷键同一作用域修正）。
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const doReg = async () => {
      try {
        if (!(await isReg("F12"))) {
          await regShortcut("F12", () => {
            void invoke("open_devtools").catch(() => {});
          });
        }
        // 沉浸模式快捷键：与 F12 同一作用域策略（窗口聚焦期间注册，失焦即注销）
        if (!(await isReg("CommandOrControl+Shift+H"))) {
          await regShortcut("CommandOrControl+Shift+H", () => toggleImmersive());
        }
      } catch {
        /* 注册失败不影响运行时 */
      }
    };
    const doUnreg = async () => {
      try {
        if (await isReg("F12")) await unreg("F12").catch(() => {});
        if (await isReg("CommandOrControl+Shift+H")) await unreg("CommandOrControl+Shift+H").catch(() => {});
      } catch {
        /* ignore */
      }
    };
    void (async () => {
      try {
        const focused = await appWindow.isFocused().catch(() => true);
        if (disposed) return;
        if (focused) await doReg();
        unlisten = await appWindow.onFocusChanged(({ payload: f }) => {
          if (f) void doReg();
          else void doUnreg();
        });
        if (disposed) unlisten?.();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
      void unreg("F12").catch(() => {});
      void unreg("CommandOrControl+Shift+H").catch(() => {});
    };
  }, [appWindow, toggleImmersive]);

  // 关闭请求（点 X / Alt+F4 / 托盘退出）→ 拦截并弹出三选一
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    (async () => {
      unlisten = await appWindow.onCloseRequested((event) => {
        event.preventDefault();
        if (active) setCloseDialogOpen(true);
      });
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [appWindow]);

  // 订阅引擎健康状态
  useEffect(() => {
    return onEngineHealth((h) => {
      setHealth(h);
      // 引擎地址变化 → 下方导航 effect 依赖 engineUrl，会自动重新打开引擎界面
    });
  }, [setHealth]);

  // 启动时加载已验证版本白名单（配置文件 verified-versions.json，缺失时用内置默认）
  useEffect(() => {
    void loadVerifiedVersions().catch(() => {});
  }, []);

  // 启动时扫描已有 dsh 实例（网页版 3080 等在跑则直接复用，自动进入主界面）
  useEffect(() => {
    void (async () => {
      const found = await findExistingInstanceInfo();
      if (found !== null) {
        // 端口就绪 ≠ 业务就绪：这条路径绕过 startEngine，而「引擎已在跑、客户端复用」
        // 恰是冷启动故障链（过早导航 → 网页端清空 dsh.sessions.current）的主入口，
        // 必须与 startEngine 的三条出口一样过业务就绪闸门（unavailable/超时自动放行）。
        await waitEngineBusinessReady(found.port);
        setHealth({
          status: "running",
          port: found.port,
          url: `http://127.0.0.1:${found.port}`,
          owned: found.owned,
        });
      }
    })();
  }, [setHealth]);

  // 向 Rust 侧登记当前引擎端口：托盘「完全退出」由 Rust 按端口强杀引擎进程。
  // 必要性：引擎由前端 spawn，就绪后主窗口顶层导航到引擎页 → 壳的 JS 上下文被替换，
  // 托盘菜单事件再也回不到前端；且复用的外部实例（用户自己的 dsh web）不在
  // shell 插件的子进程表里，退出 GUI 不会带走它。端口登记到 Rust 后，
  // 「完全退出」在导航后依然能杀掉引擎（含复用实例）。
  useEffect(() => {
    void invoke("set_engine_port", {
      port: health.status === "running" ? health.port : null,
    }).catch(() => {});
  }, [health.status, health.port]);

  // 托盘「重启引擎」的真正执行处（只在挂载后跑一次）。
  // 端口优先用 Rust 侧带过来的（那是引擎的事实端口）；标记里没有有效端口时退回 getEnginePort()。
  // pendingRestartRef 是幂等闸门：StrictMode 下 effect 会成对执行两次，没有它就会连重启两轮。
  useEffect(() => {
    const intent = restartIntent.current;
    if (intent === null || pendingRestartRef.current !== null) return;
    const target = intent > 0 ? intent : getEnginePort();
    pendingRestartRef.current = target;
    void (async () => {
      try {
        await restartEngineOnPort(target);
        // 成功：交回自动跳转（此时端口已就绪，导航 effect 会把窗口带回引擎页）
        setManageMode(false);
      } catch {
        /* 失败状态已通过 health 广播；停在管理模式即可看到错误并重试 */
      } finally {
        setTrayRestarting(false);
      }
    })();
  }, []);

  const running = health.status === "running";
  const engineUrl = health.url || `http://127.0.0.1:${health.port}`;
  // 沉浸模式下两条栏收起；鼠标贴到窗口边缘（peek）时临时展开
  const barsVisible = !immersive || peek;

  // Ctrl + 滚轮缩放（浏览器习惯；wheel 事件是唯一跨 iframe 冒泡的事件，
  // 挂在容器 div 上即可捕获 iframe 内容区的滚轮——浏览器为支持 Ctrl+滚轮缩放特意如此）
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom(Math.round((zoom + delta) * 10) / 10);
  };

  const peekAtEdge = () => {
    window.clearTimeout(peekTimerRef.current);
    setPeek(true);
  };
  const unpeekLater = () => {
    peekTimerRef.current = window.setTimeout(() => setPeek(false), 600);
  };

  // ── 引擎就绪后：主窗口整体导航到引擎页面（顶层文档）──
  // 历史结论（勿回退）：
  // - iframe：跨站上下文拿不到引擎的 SameSite=Strict 会话 Cookie，永远 401；
  // - 同窗口子 webview（Tauri unstable 多 webview）：WebView2 多 controller 在本机
  //   渲染黑屏，resize/置顶均无法恢复。
  // 顶层导航 + 自签 Cookie 注入（src/lib/engineAuth.ts）是最稳的组合。
  // 注意：导航会替换掉壳的 JS 上下文（标题栏/状态栏不再渲染，属预期行为），
  // 所以导航前必须注销全部全局快捷键，否则会永久残留抢占系统快捷键。
  useEffect(() => {
    if (!running || manageMode) return;
    let cancelled = false;
    void (async () => {
      const secret = await readBrowserSessionSecret();
      const auth = secret ? await buildEngineAuth(health.port, secret) : null;
      if (cancelled) return;
      for (const k of [
        "F12",
        "CommandOrControl+Shift+H",
        "CommandOrControl+Shift+Equal",
        "CommandOrControl+Equal",
        "CommandOrControl+NumpadAdd",
        "CommandOrControl+Minus",
        "CommandOrControl+NumpadSubtract",
        "CommandOrControl+Digit0",
      ]) {
        if (await isReg(k).catch(() => false)) await unreg(k).catch(() => {});
      }
      try {
        await invoke("open_engine_in_main", { url: engineUrl, authJs: auth?.js ?? "" });
      } catch (e) {
        console.error("[engine-view] open failed:", e);
        // 打开失败在黑屏时看不到 console，落盘便于排查
        try {
          await writeTextFile(
            "C:\\Windows\\Temp\\dsh-engine-view.log",
            `${new Date().toISOString()} open failed err=${String(e)}\n`,
          );
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [running, engineUrl, health.port, manageMode]);

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[rgb(10_10_12)] text-gray-100 select-none">
      {/* 沉浸模式：顶/底 5px 热区，鼠标贴边临时唤出标题栏/状态栏 */}
      {immersive && !peek && (
        <div className="absolute inset-x-0 top-0 z-50 h-1.5" onMouseEnter={peekAtEdge} />
      )}
      {immersive && !peek && (
        <div className="absolute inset-x-0 bottom-0 z-50 h-1.5" onMouseEnter={peekAtEdge} />
      )}
      {/* 进入沉浸模式的一次性提示 */}
      {immersive && showImmersiveHint && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-3 py-1 text-[11px] text-gray-200 shadow-lg">
          沉浸模式已开启：按 Ctrl+Shift+H 或鼠标移到屏幕边缘唤出
        </div>
      )}

      <div
        className={`overflow-hidden transition-[height] duration-200 ease-out ${
          barsVisible ? "h-9" : "h-0"
        }`}
        onMouseEnter={peekAtEdge}
        onMouseLeave={unpeekLater}
      >
        <TitleBar
          immersive={immersive}
          onToggleImmersive={toggleImmersive}
          onOpenKeyManager={() => setKeyManagerOpen(true)}
        />
      </div>
      {manageMode ? (
        trayRestarting ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              正在重启引擎…
            </div>
            <div className="max-w-md text-center text-[11px] leading-5 text-gray-600">
              正在关闭旧进程并按原端口重新启动；旧实例上正在运行的 agent 任务会被中断。
              首次启动或内核刚更新时可能需要数分钟，请稍候，完成后会自动回到引擎界面。
            </div>
          </div>
        ) : running ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="text-sm text-gray-200">管理模式：标题栏「升级内核」、状态栏「回滚 / 清理 / 密钥」均可用</div>
            <button
              onClick={() => setManageMode(false)}
              className="rounded-lg bg-purple-500 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-400"
            >
              进入引擎界面
            </button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="pt-4 text-center text-[11px] text-gray-600">
              管理模式——启动引擎后可点击「进入引擎界面」返回 WebUI
            </div>
            <div className="flex-1 overflow-hidden">
              <EngineLauncher />
            </div>
          </div>
        )
      ) : !running && !launchRequested ? (
        <div className="flex-1 overflow-hidden">
          <EngineLauncher />
        </div>
      ) : (
        <main className="min-h-0 w-full flex-1" onWheel={onWheel}>
          {running ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-gray-400">
              <span>正在打开引擎界面…</span>
              <span className="text-[11px] text-gray-600">窗口即将切换到 DeepSeek Harness WebUI</span>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              引擎启动中…
            </div>
          )}
        </main>
      )}
      <div
        className={`overflow-hidden transition-[height] duration-200 ease-out ${
          barsVisible ? "h-6" : "h-0"
        }`}
        onMouseEnter={peekAtEdge}
        onMouseLeave={unpeekLater}
      >
        <StatusBar zoom={zoom} onZoomChange={setZoom} />
      </div>
      {closeDialogOpen && (
        <CloseDialog
          onMinimizeToTray={() => {
            setCloseDialogOpen(false);
            void appWindow.hide();
          }}
          onCloseWindow={() => {
            setCloseDialogOpen(false);
            // 只关窗口，引擎保持后台运行（不 kill）
            void appWindow.destroy();
          }}
          onStopAndExit={() => {
            setCloseDialogOpen(false);
            void (async () => {
              try {
                await stopEngine();
              } finally {
                await appWindow.destroy();
              }
            })();
          }}
          onCancel={() => setCloseDialogOpen(false)}
        />
      )}
      {keyManagerOpen && <KeyManagerDialog onClose={() => setKeyManagerOpen(false)} />}
    </div>
  );
}
