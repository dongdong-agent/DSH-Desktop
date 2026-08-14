import { useEffect, useRef, useState } from "react";
import { Send, Square, Loader2, GitBranch, Eye } from "lucide-react";
import { useSessionStore } from "../stores/sessionStore";
import { useChatStore } from "../stores/chatStore";
import { useEngineStore } from "../stores/engineStore";
import { cancelSession, forkSession, sendPrompt } from "../lib/api";
import { sessionTitle, type SessionMessage } from "../lib/types";
import { MessageBubble } from "./MessageBubble";
import { TrajectoryView } from "./TrajectoryView";

/** 稳定空数组引用（zustand selector 内联创建新数组会触发无限重渲染 → React #185） */
const EMPTY_MESSAGES: SessionMessage[] = [];
const EMPTY_STRING = "";

export function ChatPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const view = useChatStore((s) => s.view);
  const setView = useChatStore((s) => s.setView);
  const messages = useChatStore((s) =>
    activeSessionId ? (s.messages[activeSessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  );
  const generating = useChatStore((s) => s.generating);
  const draft = useChatStore((s) => (activeSessionId ? (s.drafts[activeSessionId] ?? EMPTY_STRING) : EMPTY_STRING));
  const setDraft = useChatStore((s) => s.setDraft);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const setGenerating = useChatStore((s) => s.setGenerating);
  const health = useEngineStore((s) => s.health);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);

  // 草稿与输入框同步
  useEffect(() => {
    setInput(draft);
  }, [draft, activeSessionId]);

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, generating]);

  const submit = async () => {
    const text = input.trim();
    if (!text || !activeSessionId || generating) return;
    setDraft(activeSessionId, "");
    setInput("");
    setGenerating(true);
    // 乐观追加用户消息
    appendMessage({
      id: `local-${Date.now()}`,
      sessionId: activeSessionId,
      role: "user",
      content: text,
      createdAt: Date.now(),
    });
    const ok = await sendPrompt(activeSessionId, text);
    if (!ok) {
      setGenerating(false);
      appendMessage({
        id: `local-err-${Date.now()}`,
        sessionId: activeSessionId,
        role: "system",
        content: "⚠️ 发送失败：请检查引擎状态与模型配置",
        createdAt: Date.now(),
      });
    }
  };

  const handleCancel = async () => {
    if (activeSessionId) await cancelSession(activeSessionId);
    setGenerating(false);
  };

  const handleFork = async () => {
    if (!activeSessionId) return;
    const fork = await forkSession(activeSessionId);
    if (fork) {
      useSessionStore.getState().upsertSession(fork);
      useSessionStore.getState().setActiveSession(fork.sessionId);
    }
  };

  // 键盘提交（Ctrl+Enter / Enter）
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  if (!activeSessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-500">
        <div className="text-4xl">💬</div>
        <div className="text-sm">选择一个会话开始对话，或新建会话</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-[rgb(10_10_12)]">
      {/* 会话头 */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-gray-100">
            {activeSession ? sessionTitle(activeSession) : "未命名会话"}
          </div>
          <div className="text-[10.5px] text-gray-500">
            {activeSession?.agentPreset ?? ""}
            {activeSession?.running ? " · 运行中" : ""}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView(view === "chat" ? "trajectory" : "chat")}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
              view === "trajectory"
                ? "bg-[rgb(168_85_247_/_0.18)] text-purple-300"
                : "text-gray-400 hover:bg-white/[0.06] hover:text-gray-200"
            }`}
            title="Trajectory 轨迹视图"
          >
            <Eye size={12} /> {view === "trajectory" ? "对话" : "轨迹"}
          </button>
          <button
            onClick={handleFork}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-400 hover:bg-white/[0.06] hover:text-gray-200"
            title="分叉会话"
          >
            <GitBranch size={12} /> 分叉
          </button>
        </div>
      </div>

      {/* 主区 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "trajectory" ? (
          <TrajectoryView />
        ) : (
          <div ref={scrollRef} className="h-full overflow-y-auto px-4 py-3">
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-gray-600">
                  <div className="text-3xl">✨</div>
                  <div className="text-sm">开始与 DeepSeek Harness 对话</div>
                  <div className="text-xs">标准模式 · 完整工具集 · 支持文件编辑 / Shell / 检索 / Skills</div>
                </div>
              ) : (
                messages.map((m) => <MessageBubble key={m.id} message={m} />)
              )}
              {generating && (
                <div className="flex items-center gap-2 py-2 text-xs text-gray-500">
                  <Loader2 size={13} className="animate-spin text-purple-400" />
                  正在生成…
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-white/[0.06] px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-white/[0.09] bg-[rgb(18_18_22)] px-3 py-2 focus-within:border-purple-500/50">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (activeSessionId) setDraft(activeSessionId, e.target.value);
              }}
              onKeyDown={onKeyDown}
              rows={Math.min(6, Math.max(1, input.split("\n").length))}
              placeholder={health.status === "running" ? "输入消息，Enter 发送，Shift+Enter 换行…" : "引擎未启动…"}
              disabled={health.status !== "running"}
              className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-[13px] leading-5 text-gray-100 outline-none placeholder:text-gray-600 disabled:opacity-50"
            />
            {generating ? (
              <button
                onClick={handleCancel}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30"
                title="停止生成"
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={() => void submit()}
                disabled={!input.trim() || health.status !== "running"}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-500/85 text-white transition-colors hover:bg-purple-500 disabled:opacity-30"
                title="发送 (Enter)"
              >
                <Send size={13} />
              </button>
            )}
          </div>
          <div className="mt-1 text-center text-[10.5px] text-gray-600">
            Enter 发送 · Shift+Enter 换行 · 工具调用与轨迹实时可见
          </div>
        </div>
      </div>
    </div>
  );
}
