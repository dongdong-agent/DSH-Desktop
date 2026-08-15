import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** 缩放范围与步进 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

/**
 * Ctrl/Cmd + 加号/减号/0 缩放 WebView（WebView2 原生缩放，作用于整个页面含 iframe）
 * - Ctrl + 加号 / Ctrl + '='  → 放大
 * - Ctrl + 减号              → 缩小
 * - Ctrl + 0                 → 重置 100%
 * 返回 [zoom, setZoom, zoomIn, zoomOut, resetZoom]
 */
export function useZoomShortcuts() {
  const [zoom, setZoomState] = useState(1);

  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 10) / 10));
    setZoomState(clamped);
    void getCurrentWebview()
      .setZoom(clamped)
      .catch((e) => console.warn("[zoom] setZoom failed:", e));
  }, []);

  const zoomIn = useCallback(() => applyZoom(zoom + ZOOM_STEP), [applyZoom, zoom]);
  const zoomOut = useCallback(() => applyZoom(zoom - ZOOM_STEP), [applyZoom, zoom]);
  const resetZoom = useCallback(() => applyZoom(1), [applyZoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      // Ctrl + 加号（'=' 是主键盘加号，'+' 是小键盘）→ 放大
      if (key === "=" || key === "+") {
        e.preventDefault();
        zoomIn();
      }
      // Ctrl + 减号 → 缩小
      else if (key === "-" || key === "_") {
        e.preventDefault();
        zoomOut();
      }
      // Ctrl + 0 → 重置
      else if (key === "0") {
        e.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut, resetZoom]);

  return { zoom, setZoom: applyZoom, zoomIn, zoomOut, resetZoom };
}
