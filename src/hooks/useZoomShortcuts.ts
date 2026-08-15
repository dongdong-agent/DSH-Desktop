import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";

/** 缩放范围与步进 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

/** 当前缩放（模块级，供全局快捷键 handler 无闭包依赖地读写） */
let currentZoom = 1;

/**
 * Ctrl/Cmd + 加号/减号/0 缩放 WebView（WebView2 原生缩放，作用于整个页面含 iframe）。
 *
 * 用 Tauri 全局快捷键（plugin-global-shortcut）实现——因为焦点在 iframe
 * （官方 WebUI）内时，外层 window 的 keydown 收不到键盘事件（跨文档不冒泡），
 * 全局快捷键在系统层捕获，任何焦点位置都生效。
 *
 * 快捷键（Windows 习惯）：
 * - Ctrl + 加号（Ctrl + '=' 主键盘 / Ctrl + '+' 小键盘）→ 放大
 * - Ctrl + 减号 → 缩小
 * - Ctrl + 0   → 重置 100%
 */
export function useZoomShortcuts() {
  const [zoom, setZoomState] = useState(1);

  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 10) / 10));
    currentZoom = clamped;
    setZoomState(clamped);
    void getCurrentWebview()
      .setZoom(clamped)
      .catch((e) => console.warn("[zoom] setZoom failed:", e));
  }, []);

  // 注册一次（无 zoom 依赖，handler 走模块级 currentZoom）
  useEffect(() => {
    const zoomUp = "CommandOrControl+=";
    const zoomDown = "CommandOrControl+-";
    const zoomReset = "CommandOrControl+0";

    void (async () => {
      for (const [shortcut, handler] of [
        [zoomUp, () => applyZoom(currentZoom + ZOOM_STEP)],
        [zoomDown, () => applyZoom(currentZoom - ZOOM_STEP)],
        [zoomReset, () => applyZoom(1)],
      ] as const) {
        try {
          if (!(await isRegistered(shortcut))) {
            await register(shortcut, handler as () => void);
          }
        } catch (e) {
          console.warn(`[zoom] register ${shortcut} failed:`, e);
        }
      }
    })();

    return () => {
      void unregister(zoomUp).catch(() => {});
      void unregister(zoomDown).catch(() => {});
      void unregister(zoomReset).catch(() => {});
    };
    // 只注册一次，不随 zoom 变化重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { zoom, setZoom: applyZoom };
}
