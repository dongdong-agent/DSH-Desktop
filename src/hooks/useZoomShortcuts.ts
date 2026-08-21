import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";

/** 缩放范围与步进 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

/** 当前缩放（模块级，供快捷键 handler 无闭包依赖地读写） */
let currentZoom = 1;

/**
 * Ctrl/Cmd + 加号/减号/0 缩放 WebView（WebView2 原生缩放，作用于整个页面含 iframe）。
 *
 * 实现说明：因为焦点在 iframe（官方 WebUI）内时外层 window 的 keydown 收不到
 * 键盘事件（跨文档不冒泡），所以用 Tauri 全局快捷键（plugin-global-shortcut）
 * 在系统层捕获 —— 但**只在本窗口聚焦时注册**：
 *
 *   - 窗口聚焦：注册 Ctrl++/-/0 → DSH 内任意焦点位置（含 iframe）都能缩放
 *   - 窗口失焦：立即注销 → 其他软件里 Ctrl++/-/0 恢复各自功能，不再被抢占
 *
 * 之前的问题是全局快捷键常驻注册，作用域被放大到整个系统，抢占其他软件的
 * 同款快捷键。本实现把作用域收回到「DSH 窗口聚焦期间」。
 */
export function useZoomShortcuts() {
  const [zoom, setZoomState] = useState(1);
  const focusedRef = useRef(false);
  const registeredRef = useRef(false);

  const applyZoom = useCallback((next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 10) / 10));
    currentZoom = clamped;
    setZoomState(clamped);
    void getCurrentWebview()
      .setZoom(clamped)
      .catch((e) => console.warn("[zoom] setZoom failed:", e));
  }, []);

  // 注册 / 注销全部缩放快捷键（幂等：先查 isRegistered 再操作）
  const registerAll = useCallback(async () => {
    if (registeredRef.current) return;
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
      } catch {
        failures.push(shortcut);
      }
    }
    registeredRef.current = true;
    // 竞态防护：注册过程中窗口已失焦 → 立即注销，避免作用域泄漏到其他软件
    if (!focusedRef.current) {
      void unregisterAll();
    }
    try {
      localStorage.setItem(
        "dsh-zoom-reg",
        JSON.stringify({ ok: failures.length === 0, failed: failures, scope: "focused-only" }),
      );
    } catch {
      /* ignore */
    }
  }, [applyZoom]);

  const unregisterAll = useCallback(async () => {
    if (!registeredRef.current) return;
    const keys = [
      "CommandOrControl+Shift+Equal",
      "CommandOrControl+Equal",
      "CommandOrControl+NumpadAdd",
      "CommandOrControl+Minus",
      "CommandOrControl+NumpadSubtract",
      "CommandOrControl+Digit0",
    ];
    for (const s of keys) {
      try {
        if (await isRegistered(s)) await unregister(s);
      } catch {
        /* ignore */
      }
    }
    registeredRef.current = false;
  }, []);

  // 聚焦时注册、失焦时注销；挂载时按当前聚焦状态初始化
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;

    const onFocus = () => {
      focusedRef.current = true;
      void registerAll();
    };
    const onBlur = () => {
      focusedRef.current = false;
      void unregisterAll();
    };

    void (async () => {
      // 初始状态：以当前是否聚焦为准（启动时窗口通常已聚焦）
      const focused = await appWindow.isFocused().catch(() => true);
      if (disposed) return;
      focusedRef.current = focused;
      if (focused) await registerAll();
      const un = await appWindow.onFocusChanged(({ payload: f }) => {
        if (f) onFocus();
        else onBlur();
      });
      if (disposed) void un();
    })();

    return () => {
      disposed = true;
      void unregisterAll();
    };
    // 只挂载一次，不随 zoom 变化重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerAll, unregisterAll]);

  return { zoom, setZoom: applyZoom };
}
