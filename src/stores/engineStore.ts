import { create } from "zustand";
import type { EngineHealth } from "../lib/types";

interface EngineState {
  health: EngineHealth;
  setHealth: (h: EngineHealth) => void;
  /** 引擎进程是否由本应用 spawn */
  owned: boolean;
  setOwned: (v: boolean) => void;
  /** 用户是否已确认启动引擎 */
  launchRequested: boolean;
  setLaunchRequested: (v: boolean) => void;
}

const initialHealth: EngineHealth = {
  status: "stopped",
  port: 17800,
  url: "http://127.0.0.1:17800",
};

export const useEngineStore = create<EngineState>()((set) => ({
  health: initialHealth,
  setHealth: (h) => set({ health: h }),
  owned: false,
  setOwned: (v) => set({ owned: v }),
  launchRequested: false,
  setLaunchRequested: (v) => set({ launchRequested: v }),
}));
