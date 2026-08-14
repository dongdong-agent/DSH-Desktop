import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import "./index.css";

// 全局未捕获错误 → 落盘，黑屏时可定位
window.addEventListener("error", (e) => {
  try {
    localStorage.setItem("dsh-error", `window.onerror: ${e.message} @ ${e.filename}:${e.lineno}`);
  } catch {
    /* noop */
  }
});
window.addEventListener("unhandledrejection", (e) => {
  try {
    localStorage.setItem(
      "dsh-error",
      `unhandledrejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`,
    );
  } catch {
    /* noop */
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
