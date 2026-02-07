"use client";

import {
  AlertCircle,
  Download,
  MessageSquareText,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";

import { useChat } from "../hooks/useChat";

// Lazy load heavy markdown dependencies
const ReactMarkdown = lazy(() => import("react-markdown"));
const remarkGfm = import("remark-gfm").then((mod) => mod.default);
const rehypeSanitize = import("rehype-sanitize").then((mod) => mod.default);

// Simple markdown fallback for initial render
function SimpleMarkdown({ content }: { content: string }) {
  return (
    <div className="whitespace-pre-wrap break-words">
      {content}
    </div>
  );
}

// Markdown wrapper with lazy loading
function ChatMarkdown({ content }: { content: string }) {
  const [plugins, setPlugins] = useState<{ remark: unknown[]; rehype: unknown[] }>({
    remark: [],
    rehype: [],
  });

  useEffect(() => {
    Promise.all([remarkGfm, rehypeSanitize]).then(([remark, rehype]) => {
      setPlugins({ remark: [remark], rehype: [rehype] });
    });
  }, []);

  return (
    <Suspense fallback={<SimpleMarkdown content={content} />}>
      <ReactMarkdown
        remarkPlugins={plugins.remark as never[]}
        rehypePlugins={plugins.rehype as never[]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match;
            return isInline ? (
              <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            ) : (
              <code className={className}>{children}</code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </Suspense>
  );
}

const MAX_INPUT_CHARS = 2000;
const TYPING_INDICATOR_DELAY = 600;

/**
 * Improved ChatWidget with production-grade UX:
 * - Debounced send button (prevents double-submit)
 * - Character counter with visual feedback
 * - Network failure indicator with retry
 * - Better scrolling behavior
 * - Auto-focus input on mount
 * - Clear chat button with confirmation
 * - Accessibility improvements
 * - Persistent chat history via localStorage
 */
export function ChatWidget() {
  const pathname = usePathname() ?? "/";
  const {
    open,
    setOpen,
    nudge,
    setNudge,
    streaming,
    input,
    setInput,
    messages,
    networkError,
    retryMessage,
    followUpQuestions,
    characterCount,
    characterLimitReached,
    canSend,
    showClearConfirm,
    send,
    clearChat,
    resetClearConfirm,
    ux,
  } = useChat(pathname);

  const [showTypingIndicator, setShowTypingIndicator] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const typingTimerRef = useRef<number | null>(null);
  const lastAnnouncedIdRef = useRef<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);

  // Character count visual logic
  const characterNearLimit = characterCount >= MAX_INPUT_CHARS * 0.9;
  const characterCountColor = characterLimitReached
    ? "text-danger"
    : characterNearLimit
      ? "text-yellow-500"
      : "text-white/40";

  // Auto-resize textarea
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 120;
    textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  }, [input]);

  // Auto-focus input when chat opens
  useEffect(() => {
    if (open && isInitialMount.current) {
      // Small delay to ensure animation has started
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
    isInitialMount.current = false;
  }, [open]);

  // Focus input when opening chat (not just initial mount)
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Improved scroll to bottom with smooth behavior
  useEffect(() => {
    if (!open) return;

    // Use requestAnimationFrame for smoother scrolling
    const rafId = requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [messages, open]);

  // Auto-scroll during streaming
  useEffect(() => {
    if (!streaming || !open) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    // Scroll more frequently during streaming
    const intervalId = setInterval(() => {
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        100;

      if (isNearBottom) {
        messagesEndRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      }
    }, 100);

    return () => clearInterval(intervalId);
  }, [streaming, open]);

  // Typing indicator with delay
  useEffect(() => {
    if (streaming) {
      typingTimerRef.current = window.setTimeout(() => {
        setShowTypingIndicator(true);
      }, TYPING_INDICATOR_DELAY);
    } else {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
      setShowTypingIndicator(false);
    }

    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
      }
    };
  }, [streaming]);

  // Reset clear confirm when closing
  useEffect(() => {
    if (!open) {
      resetClearConfirm();
    }
  }, [open, resetClearConfirm]);

  // Accessible announcements for streaming updates
  useEffect(() => {
    if (streaming) {
      setLiveMessage(`${ux.loadingLabel}`);
      return;
    }

    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content);
    if (lastAssistant && lastAssistant.id !== lastAnnouncedIdRef.current) {
      lastAnnouncedIdRef.current = lastAssistant.id;
      setLiveMessage("ElonSim response ready.");
    }
  }, [messages, streaming, ux.loadingLabel]);

  const handleRetry = useCallback(() => {
    if (retryMessage) {
      void send(retryMessage, true);
    }
  }, [retryMessage, send]);

  const handleExportChat = useCallback(() => {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const pageContext = pathname !== "/" ? pathname : "Homepage";

    let markdown = `# ElonGoat Chat Export\n\n`;
    markdown += `**Date:** ${dateStr} ${timeStr}\n`;
    markdown += `**Topic:** ${pageContext}\n`;
    markdown += `**Messages:** ${messages.length}\n\n`;
    markdown += `---\n\n`;

    for (const msg of messages) {
      if (msg.role === "user") {
        markdown += `## User\n\n${msg.content}\n\n`;
      } else {
        markdown += `## ElonSim\n\n${msg.content}\n\n`;
      }
    }

    markdown += `---\n\n`;
    markdown += `*Generated by [elongoat.io](https://elongoat.io)*`;

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elongoat-chat-${dateStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [messages, pathname]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (canSend) void send(input);
      }
      // Escape to close chat
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    },
    [input, canSend, send, open, setOpen],
  );

  const hasMessagesBeyondInitial = messages.length > 1;

  return (
    <div
      className={`fixed z-50 ${
        open
          ? "bottom-0 left-0 right-0 sm:bottom-4 sm:left-auto sm:right-4"
          : "bottom-4 right-4"
      }`}
      role="region"
      aria-label="Chat widget"
    >
      {open ? (
        <div className="chat-panel-animate glass glow-ring w-full overflow-hidden rounded-t-3xl sm:w-[360px] sm:rounded-3xl md:w-[400px]">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/30 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                <Image
                  alt="ElonGoat"
                  src="/favicon.svg"
                  width={28}
                  height={28}
                  className="opacity-90"
                />
                {streaming && (
                  <span className="absolute bottom-0 right-0 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">
                  ElonSim Chat
                </div>
                <div
                  className="truncate text-xs text-white/55"
                  aria-live="polite"
                >
                  {networkError
                    ? "Connection lost"
                    : streaming
                      ? ux.loadingLabel
                      : "Streaming • history saved locally"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Export chat button */}
              <button
                type="button"
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={handleExportChat}
                aria-label="Export chat as markdown"
                title="Export chat as markdown"
              >
                <Download className="h-4 w-4" />
              </button>

              {/* Clear chat button */}
              {hasMessagesBeyondInitial && (
                <button
                  type="button"
                  className={`rounded-xl border p-2 text-white/70 transition ${
                    showClearConfirm
                      ? "border-danger bg-danger/20 text-danger hover:bg-danger/30"
                      : "border-white/10 bg-white/5 hover:bg-white/10 hover:text-white"
                  }`}
                  onClick={clearChat}
                  aria-label={showClearConfirm ? "Confirm clear" : "Clear chat"}
                  title={
                    showClearConfirm ? "Click again to confirm" : "Clear chat"
                  }
                >
                  {showClearConfirm ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              )}

              <button
                id="chat-close"
                type="button"
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {liveMessage}
          </div>
          <div
            ref={messagesContainerRef}
            className="max-h-[60vh] overflow-y-auto px-3 py-3 sm:max-h-[52vh] sm:px-4 sm:py-4"
            role="log"
            aria-live="polite"
            aria-atomic="false"
          >
            {/* Quick start buttons */}
            {!hasMessagesBeyondInitial && (
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {ux.quickStart.slice(0, 4).map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 transition hover:border-white/20 hover:bg-white/10 sm:px-3 sm:text-xs active:bg-white/15 disabled:opacity-50"
                    onClick={() => void send(q)}
                    disabled={streaming}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Conversation list */}
            <div className="mt-4 flex flex-col gap-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`relative max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:px-4 sm:text-base ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-white/10 text-white/90 rounded-bl-sm"
                    } ${msg.error ? "border border-danger/50 bg-danger/10 text-danger" : ""}`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-invert prose-sm max-w-none break-words">
                        <ChatMarkdown content={msg.content} />
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap break-words">
                        {msg.content}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {showTypingIndicator && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-white/10 px-4 py-3">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 delay-0" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 delay-150" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40 delay-300" />
                  </div>
                </div>
              )}

              {/* Error retry button */}
              {networkError && (
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="flex items-center gap-2 rounded-full border border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger transition hover:bg-danger/20"
                  >
                    <AlertCircle className="h-3 w-3" />
                    <span>Failed to send. Tap to retry.</span>
                  </button>
                </div>
              )}

              {/* Follow-up suggestions */}
              {!streaming && followUpQuestions.length > 0 && (
                <div className="animate-fade-in mt-2 flex flex-col gap-2">
                  <div className="text-xs font-medium text-white/40 uppercase tracking-wider ml-1">
                    Suggested
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {followUpQuestions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="text-left bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-xl px-3 py-2 text-xs sm:text-sm text-white/80 transition-all active:scale-[0.98]"
                        onClick={() => void send(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-px w-full" />
            </div>
          </div>

          {/* Input Area */}
          <div className="border-t border-white/10 bg-black/40 p-3 backdrop-blur-md sm:p-4">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={ux.inputPlaceholder}
                className="max-h-32 w-full resize-none rounded-2xl border border-white/10 bg-white/5 py-3 pl-4 pr-12 text-[15px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50 sm:text-base"
                rows={1}
                disabled={streaming}
                aria-label="Chat input"
                maxLength={MAX_INPUT_CHARS}
              />

              <div className="absolute bottom-2 right-2 flex items-center gap-2">
                <span
                  className={`text-[10px] ${characterCountColor} transition-colors duration-200 pointer-events-none select-none hidden sm:block`}
                >
                  {characterCount}/{MAX_INPUT_CHARS}
                </span>
                <button
                  type="button"
                  onClick={() => void send(input)}
                  disabled={!canSend}
                  className="rounded-xl bg-white p-1.5 text-black disabled:hidden disabled:opacity-0 transition-all hover:bg-white/90 active:scale-95"
                  aria-label="Send message"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-4 w-4 sm:h-5 sm:w-5"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Mobile char count */}
            {characterCount > 0 && (
              <div
                className={`mt-1 text-right text-[10px] sm:hidden ${characterCountColor}`}
              >
                {characterCount}/{MAX_INPUT_CHARS}
              </div>
            )}

            <div className="mt-2 text-center">
              <p className="text-[10px] text-white/30">
                AI can make mistakes. Check important info.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex justify-end">
          {nudge ? (
            <div className="absolute -top-14 right-0 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-3 py-2 shadow-xl backdrop-blur">
              <span className="text-xs text-white/80">
                Ask ElonSim anything
              </span>
              <button
                type="button"
                onClick={() => setNudge(false)}
                aria-label="Dismiss notification"
                className="rounded-full p-1 text-white/60 transition hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          <button
            id="chat-open"
            type="button"
            className="glass glow-ring group flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
            onClick={() => {
              setOpen(true);
              setNudge(false);
            }}
            aria-label="Open chat"
          >
            <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <Image
                alt="ElonGoat"
                src="/favicon.svg"
                width={28}
                height={28}
                className="opacity-90"
              />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                Chat <MessageSquareText className="h-4 w-4 text-white/70" />
              </span>
              <span className="block truncate text-xs text-white/55">
                {ux.buttonTagline}
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
