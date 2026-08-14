import { create } from "zustand";
import type { AgentPreset, SessionId, SessionSummary } from "../lib/types";

interface SessionState {
  sessions: SessionSummary[];
  activeSessionId: SessionId | null;
  loading: boolean;
  presets: AgentPreset[];
  activePreset: string;
  setSessions: (s: SessionSummary[]) => void;
  upsertSession: (s: SessionSummary) => void;
  removeSession: (id: SessionId) => void;
  setActiveSession: (id: SessionId | null) => void;
  setLoading: (v: boolean) => void;
  setPresets: (p: AgentPreset[]) => void;
  setActivePreset: (p: string) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  sessions: [],
  activeSessionId: null,
  loading: false,
  presets: [],
  activePreset: "standard",
  setSessions: (s) => set({ sessions: s }),
  upsertSession: (s) =>
    set((st) => {
      const idx = st.sessions.findIndex((x) => x.sessionId === s.sessionId);
      if (idx === -1) return { sessions: [s, ...st.sessions] };
      const next = [...st.sessions];
      next[idx] = { ...next[idx], ...s };
      // 更新过的会话提到最前（最近活动）
      const [moved] = next.splice(idx, 1);
      return { sessions: [moved, ...next] };
    }),
  removeSession: (id) =>
    set((st) => ({
      sessions: st.sessions.filter((x) => x.sessionId !== id),
      activeSessionId: st.activeSessionId === id ? null : st.activeSessionId,
    })),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setLoading: (v) => set({ loading: v }),
  setPresets: (p) => set({ presets: p }),
  setActivePreset: (p) => set({ activePreset: p }),
}));
