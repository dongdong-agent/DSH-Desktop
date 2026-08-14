import { MessageSquare, Settings2, Layers, RefreshCw } from "lucide-react";
import { useUiStore, type AppView } from "../stores/uiStore";
import { useSessionStore } from "../stores/sessionStore";
import { listSessions } from "../lib/api";

/** 左侧导航栏（图标栏，固定 44px） */
export function Sidebar({ collapsed: _collapsed }: { collapsed: boolean }) {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setLoading = useSessionStore((s) => s.setLoading);

  const refreshSessions = async () => {
    setLoading(true);
    const sessions = await listSessions();
    setSessions(sessions);
    setLoading(false);
  };

  const items: Array<{ id: AppView; label: string; icon: React.ReactNode }> = [
    { id: "chat", label: "对话", icon: <MessageSquare size={17} /> },
    { id: "presets", label: "模式", icon: <Layers size={17} /> },
    { id: "settings", label: "设置", icon: <Settings2 size={17} /> },
  ];

  return (
    <nav
      className={`flex shrink-0 flex-col items-center border-r border-white/[0.06] bg-[rgb(14_14_17)] py-2 w-11`}
    >
      <div className="flex flex-col gap-1">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setView(it.id)}
            title={it.label}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              view === it.id
                ? "bg-[rgb(168_85_247_/_0.18)] text-purple-300"
                : "text-gray-400 hover:bg-white/[0.06] hover:text-gray-200"
            }`}
          >
            {it.icon}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-1">
        <button
          onClick={refreshSessions}
          title="刷新会话"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-white/[0.06] hover:text-gray-200"
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </nav>
  );
}
