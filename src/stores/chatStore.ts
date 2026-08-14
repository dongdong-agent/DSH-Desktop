import { create } from "zustand";
import type { SessionMessage, TrajectoryEvent } from "../lib/types";

interface ChatState {
  /** 当前会话消息（按时间序） */
  messages: Record<string, SessionMessage[]>;
  /** 轨迹事件（Trajectory 视图） */
  trajectory: TrajectoryEvent[];
  /** 是否正在生成 */
  generating: boolean;
  /** 输入框内容（草稿保留） */
  drafts: Record<string, string>;
  /** 当前视图：chat | trajectory */
  view: "chat" | "trajectory";
  setView: (v: "chat" | "trajectory") => void;
  appendMessage: (m: SessionMessage) => void;
  updateMessage: (id: string, patch: Partial<SessionMessage>) => void;
  clearSession: (sessionId: string) => void;
  appendTrajectory: (e: TrajectoryEvent) => void;
  clearTrajectory: () => void;
  setGenerating: (v: boolean) => void;
  setDraft: (sessionId: string, text: string) => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  messages: {},
  trajectory: [],
  generating: false,
  drafts: {},
  view: "chat",
  setView: (v) => set({ view: v }),
  appendMessage: (m) =>
    set((st) => {
      const list = st.messages[m.sessionId] ?? [];
      // 幂等：同 id 已存在则替换
      const idx = list.findIndex((x) => x.id === m.id);
      const next = idx === -1 ? [...list, m] : list.map((x) => (x.id === m.id ? m : x));
      return { messages: { ...st.messages, [m.sessionId]: next } };
    }),
  updateMessage: (id, patch) =>
    set((st) => {
      const next: Record<string, SessionMessage[]> = {};
      for (const [sid, list] of Object.entries(st.messages)) {
        next[sid] = list.map((x) => (x.id === id ? { ...x, ...patch } : x));
      }
      return { messages: next };
    }),
  clearSession: (sessionId) =>
    set((st) => {
      const next = { ...st.messages };
      delete next[sessionId];
      return { messages: next };
    }),
  appendTrajectory: (e) => set((st) => ({ trajectory: [...st.trajectory, e] })),
  clearTrajectory: () => set({ trajectory: [] }),
  setGenerating: (v) => set({ generating: v }),
  setDraft: (sessionId, text) => set((st) => ({ drafts: { ...st.drafts, [sessionId]: text } })),
}));
