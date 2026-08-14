import { create } from "zustand";

export type AppView = "chat" | "settings" | "presets";

interface UiState {
  view: AppView;
  setView: (v: AppView) => void;
  /** 侧边栏是否折叠 */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** 面板宽度（会话列表） */
  sessionListWidth: number;
  setSessionListWidth: (w: number) => void;
  /** 显示设置面板 */
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  view: "chat",
  setView: (v) => set({ view: v }),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  sessionListWidth: 260,
  setSessionListWidth: (w) => set({ sessionListWidth: Math.max(180, Math.min(420, w)) }),
  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),
}));
