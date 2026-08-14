import { useEffect, useState } from "react";
import { useEngineStore } from "./stores/engineStore";
import { TitleBar } from "./components/TitleBar";
import { StatusBar } from "./components/StatusBar";
import { EngineLauncher } from "./components/EngineLauncher";
import { setApiBase } from "./lib/api";
import { findExistingInstance, onEngineHealth } from "./lib/dshEngine";

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

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[rgb(10_10_12)] text-gray-100 select-none">
      <TitleBar />
      {!running && !launchRequested ? (
        <div className="flex-1 overflow-hidden">
          <EngineLauncher />
        </div>
      ) : (
        <main className="min-h-0 w-full flex-1">
          {running ? (
            <iframe
              key={iframeKey}
              src={engineUrl}
              className="h-full w-full border-0 bg-white"
              title="DeepSeek Harness WebUI"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              引擎启动中…
            </div>
          )}
        </main>
      )}
      <StatusBar />
    </div>
  );
}
