import { useEffect, useState } from "react";
import { Plus, MessageSquare, Loader2 } from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { createSession, listSessions, renameSession } from "../lib/api";
import { sessionTitle, type SessionSummary } from "../lib/types";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function SessionItem({ session }: { session: SessionSummary }) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(sessionTitle(session));

  const active = activeSessionId === session.sessionId;
  const titleText = sessionTitle(session);
  const stats = session.projections?.values?.sessionStats;

  const commitRename = async () => {
    setRenaming(false);
    if (title.trim() && title.trim() !== titleText) {
      await renameSession(session.sessionId, title.trim());
      useSessionStore.getState().upsertSession({
        ...session,
        projections: { ...session.projections, values: { ...session.projections?.values, title: title.trim() } },
      });
    } else {
      setTitle(titleText);
    }
  };

  return (
    <div
      onClick={() => setActiveSession(session.sessionId)}
      className={`group cursor-pointer rounded-lg px-2 py-1.5 transition-colors ${
        active ? "bg-[rgb(168_85_247_/_0.16)]" : "hover:bg-white/[0.05]"
      }`}
    >
      <div className="flex items-center gap-2">
        <MessageSquare size={13} className={active ? "text-purple-300" : "text-gray-500"} />
        {renaming ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => e.key === "Enter" && commitRename()}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-purple-500/40 bg-[rgb(20_20_24)] px-1 py-0.5 text-xs text-gray-100 outline-none"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            className={`min-w-0 flex-1 truncate text-[12.5px] ${
              active ? "text-purple-100" : "text-gray-300"
            }`}
            title={titleText}
          >
            {titleText}
          </span>
        )}
        {session.running && (
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" title="运行中" />
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between pl-5">
        <span className="truncate text-[10.5px] text-gray-500">
          {session.agentPreset}
          {stats ? ` · ${stats.turns ?? 0}轮/${stats.steps ?? 0}步` : ""}
        </span>
        <span className="shrink-0 text-[10.5px] text-gray-600">{formatTime(session.updatedAt)}</span>
      </div>
    </div>
  );
}

export function SessionList() {
  const sessions = useSessionStore((s) => s.sessions);
  const loading = useSessionStore((s) => s.loading);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    const list = await listSessions();
    setSessions(list);
    if (!activeSessionId && list.length > 0) {
      setActiveSession(list[0].sessionId);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    const session = await createSession();
    if (session) {
      useSessionStore.getState().upsertSession(session);
      setActiveSession(session.sessionId);
    }
    setCreating(false);
  };

  return (
    <div className="flex h-full flex-col bg-[rgb(12_12_15)]">
      <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">会话</span>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-white/[0.07] hover:text-purple-300 disabled:opacity-50"
          title="新建会话"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-500">
            <Loader2 size={13} className="animate-spin" /> 加载中…
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs leading-5 text-gray-600">
            暂无会话
            <br />
            点击 + 新建
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sessions.map((s) => (
              <SessionItem key={s.sessionId} session={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
