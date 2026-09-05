import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register as regShortcut, isRegistered as isReg, unregister as unreg } from "@tauri-apps/plugin-global-shortcut";
import { useEngineStore } from "./stores/engineStore";
import { TitleBar } from "./components/TitleBar";
import { StatusBar } from "./components/StatusBar";
import { EngineLauncher } from "./components/EngineLauncher";
import { CloseDialog } from "./components/CloseDialog";
import { KeyManagerDialog } from "./components/KeyManagerDialog";
import { setApiBase } from "./lib/api";
import { findExistingInstance, onEngineHealth, stopEngine, loadVerifiedVersions } from "./lib/dshEngine";
import { useZoomShortcuts } from "./hooks/useZoomShortcuts";

/**
 * DSH Desktop：Tauri 壳 + 内嵌官方 WebUI
 * - 壳：自定义标题栏（窗口控制）/ 底部状态栏 / 引擎管理
 * - 内容区：iframe 全屏加载官方 dsh web（复用已有实例或自动启动）
 * 官方 UI 自带完整侧栏（会话/设置/插件），无需自研侧栏。
 */
export default function App() {
  const health = useEngineStore((s) => s.health);
  const setHealth = useEngineStore((s) => s.setHealth);
  const launchRequested = useEngineStore((s) => s.launchRequested);
  const [iframeKey, setIframeKey] = useState(0);
  const { zoom, setZoom } = useZoomShortcuts();
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [keyManagerOpen, setKeyManagerOpen] = useState(false);
  const appWindow = getCurrentWindow();

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

  // 托盘菜单“退出并停止引擎”：停引擎后强制销毁窗口（destroy 不再触发 onCloseRequested）
  useEffect(() => {
    const unlisten = listen("tray-quit", () => {
      void (async () => {
        try {
          await stopEngine();
        } finally {
          await appWindow.destroy().catch(() => {});
        }
      })();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [appWindow]);

  // 订阅引擎健康状态
  useEffect(() => {
    return onEngineHealth((h) => {
      setHealth(h);
      if (h.status === "running") {
        setApiBase(h.url);
        // 引擎地址变化时刷新 iframe（重新加载官方 UI）
        setIframeKey((k) => k + 1);
      }
    });
  }, [setHealth]);

  // 启动时加载已验证版本白名单（配置文件 verified-versions.json，缺失时用内置默认）
  useEffect(() => {
    void loadVerifiedVersions().catch(() => {});
  }, []);

  // 启动时扫描已有 dsh 实例（网页版 3080 等在跑则直接复用，自动进入主界面）
  useEffect(() => {
    void (async () => {
      const port = await findExistingInstance();
      if (port !== null) {
        setApiBase(`http://127.0.0.1:${port}`);
        setHealth({ status: "running", port, url: `http://127.0.0.1:${port}` });
      }
    })();
  }, [setHealth]);

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
      {!running && !launchRequested ? (
        <div className="flex-1 overflow-hidden">
          <EngineLauncher />
        </div>
      ) : (
        <main className="min-h-0 w-full flex-1" onWheel={onWheel}>
          {running ? (
            <iframe
              key={iframeKey}
              src={engineUrl}
              className="h-full w-full border-0 bg-white"
              title="DeepSeek Harness WebUI"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-clipboard"
            />
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
