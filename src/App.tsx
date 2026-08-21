import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEngineStore } from "./stores/engineStore";
import { TitleBar } from "./components/TitleBar";
import { StatusBar } from "./components/StatusBar";
import { EngineLauncher } from "./components/EngineLauncher";
import { CloseDialog } from "./components/CloseDialog";
import { KeyManagerDialog } from "./components/KeyManagerDialog";
import { setApiBase } from "./lib/api";
import { findExistingInstance, onEngineHealth, stopEngine } from "./lib/dshEngine";
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

  // Ctrl + 滚轮缩放（浏览器习惯；wheel 事件是唯一跨 iframe 冒泡的事件，
  // 挂在容器 div 上即可捕获 iframe 内容区的滚轮——浏览器为支持 Ctrl+滚轮缩放特意如此）
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom(Math.round((zoom + delta) * 10) / 10);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[rgb(10_10_12)] text-gray-100 select-none">
      <TitleBar onOpenKeyManager={() => setKeyManagerOpen(true)} />
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
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-clipboard-write"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              引擎启动中…
            </div>
          )}
        </main>
      )}
      <StatusBar zoom={zoom} onZoomChange={setZoom} />
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
