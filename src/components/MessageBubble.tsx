import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import { User, Bot, Wrench, Info, CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { SessionMessage, ToolCallInfo } from "../lib/types";

function ToolCallCard({ call }: { call: ToolCallInfo }) {
  const icon =
    call.status === "success" ? (
      <CheckCircle2 size={12} className="text-emerald-400" />
    ) : call.status === "error" ? (
      <XCircle size={12} className="text-red-400" />
    ) : (
      <Loader2 size={12} className="animate-spin text-purple-400" />
    );

  const inputText =
    call.input !== undefined ? (typeof call.input === "string" ? call.input : JSON.stringify(call.input, null, 2)) : "";
  const outputText =
    call.output !== undefined
      ? typeof call.output === "string"
        ? call.output
        : JSON.stringify(call.output, null, 2)
      : "";

  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-white/[0.07] bg-[rgb(16_16_20)]">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        {icon}
        <Wrench size={11} className="text-gray-500" />
        <span className="font-mono text-[11px] text-gray-200">{call.name}</span>
        <span className="ml-auto text-[10px] text-gray-500">{call.status}</span>
      </div>
      {(inputText || outputText) && (
        <div className="max-h-52 overflow-auto border-t border-white/[0.05] px-2.5 py-1.5">
          {inputText && (
            <pre className="whitespace-pre-wrap break-all font-mono text-[10.5px] leading-4 text-gray-400">
              {inputText.length > 2000 ? inputText.slice(0, 2000) + "…" : inputText}
            </pre>
          )}
          {outputText && (
            <pre className="mt-1 whitespace-pre-wrap break-all border-t border-white/[0.05] pt-1 font-mono text-[10.5px] leading-4 text-gray-300">
              {outputText.length > 3000 ? outputText.slice(0, 3000) + "…" : outputText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({ message }: { message: SessionMessage }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-[rgb(16_16_20)] px-3 py-1 text-[11px] text-gray-400">
          <Info size={11} />
          {message.content}
        </div>
      </div>
    );
  }

  if (isTool) {
    return (
      <div className="flex justify-start pl-2">
        <div className="max-w-[85%] rounded-lg border border-white/[0.06] bg-[rgb(14_14_18)] px-3 py-2 text-[11.5px] text-gray-400">
          <pre className="whitespace-pre-wrap break-all font-mono text-[10.5px]">{message.content}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-[rgb(8_8_10)] ring-1 ring-white/[0.1]" : "bg-purple-500/20 text-purple-300"
        }`}
      >
        {isUser ? <User size={13} className="text-gray-400" /> : <Bot size={14} />}
      </div>
      <div className={`max-w-[86%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-6 ${
            isUser
              ? "rounded-tr-md bg-[rgb(168_85_247_/_0.16)] text-gray-50"
              : "rounded-tl-md border border-white/[0.06] bg-[rgb(18_18_22)] text-gray-100"
          }`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="markdown-body break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeHighlight]}
                components={{
                  pre: ({ children }) => (
                    <pre className="my-1.5 overflow-x-auto rounded-lg border border-white/[0.07] bg-[rgb(8_8_10)] p-2.5 font-mono text-[11.5px] leading-5">
                      {children}
                    </pre>
                  ),
                  code: ({ className, children }) => (
                    <code className={`${className ?? ""} text-[11.5px]`}>{children}</code>
                  ),
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="text-purple-300 underline">
                      {children}
                    </a>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-1 flex w-full flex-col gap-1">
            {message.toolCalls.map((c) => (
              <ToolCallCard key={c.id} call={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
