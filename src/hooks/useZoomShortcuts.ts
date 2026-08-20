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
    // Tauri accelerator 键名规范（来自 keyboard-types）：
    // 主键盘 = 键 → Equal；加号=Shift+Equal；减号→ Minus；
    // 小键盘 +→ NumpadAdd、-→ NumpadSubtract；数字键 → Digit0..9。
    // 不能用裸 "=" / "-"（非法键名，注册会静默失败）。
    const zoomUpKeys = [
      "CommandOrControl+Shift+Equal", // 主键盘加号（Ctrl++）
      "CommandOrControl+Equal", // 主键盘 =
      "CommandOrControl+NumpadAdd", // 小键盘 +（Num 键）
    ];
    const zoomDownKeys = [
      "CommandOrControl+Minus", // 主键盘 -
      "CommandOrControl+NumpadSubtract", // 小键盘 -
    ];
    const zoomResetKeys = ["CommandOrControl+Digit0"]; // Ctrl+0

    const failures: string[] = [];
    void (async () => {
      const bindings: Array<[string, () => void]> = [
        ...zoomUpKeys.map((s): [string, () => void] => [s, () => applyZoom(currentZoom + ZOOM_STEP)]),
        ...zoomDownKeys.map((s): [string, () => void] => [s, () => applyZoom(currentZoom - ZOOM_STEP)]),
        ...zoomResetKeys.map((s): [string, () => void] => [s, () => applyZoom(1)]),
      ];
      for (const [shortcut, handler] of bindings) {
        try {
          if (!(await isRegistered(shortcut))) {
            await register(shortcut, handler);
          }
        } catch (e) {
          failures.push(shortcut);
          console.warn(`[zoom] register ${shortcut} failed:`, e);
        }
      }
      // 暴露注册结果到 localStorage，便于诊断（状态栏可读取）
      try {
        localStorage.setItem(
          "dsh-zoom-reg",
          JSON.stringify({ ok: failures.length === 0, failed: failures }),
        );
      } catch {
        /* ignore */
      }
    })();

    return () => {
      for (const keys of [zoomUpKeys, zoomDownKeys, zoomResetKeys]) {
        for (const s of keys) void unregister(s).catch(() => {});
      }
    };
    // 只注册一次，不随 zoom 变化重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { zoom, setZoom: applyZoom };
}
