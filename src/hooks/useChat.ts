import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { getPublicEnv } from "../lib/env";
import { deriveChatUx } from "../lib/chatUi";
import { getFollowUpQuestions } from "../lib/chatTopics";

const env = getPublicEnv();

const MAX_INPUT_CHARS = 2000;
const SEND_DEBOUNCE_MS = 300;
const CHAT_STORAGE_KEY = "elongoat_chat_history";
const CHAT_STORAGE_VERSION = 1;
const MAX_STORED_MESSAGES = 50;
const STREAM_TIMEOUT = 60000; // 60 seconds for streaming
const MAX_RETRY_ATTEMPTS = 2;

export type Role = "user" | "assistant";
export type ChatItem = {
  id: string;
  role: Role;
  content: string;
  error?: boolean;
};

// Helper to generate unique IDs
function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Helper for viewport context
function getViewportLabel(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname || "/";
}

// Local Storage Helpers
function loadChatHistory(): ChatItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as {
      version?: number;
      messages: ChatItem[];
    };
    if (parsed.version !== CHAT_STORAGE_VERSION) return null;
    if (!Array.isArray(parsed.messages)) return null;
    return parsed.messages.filter(
      (m) =>
        m &&
        typeof m.id === "string" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    );
  } catch {
    return null;
  }
}

function saveChatHistory(messages: ChatItem[]): void {
  if (typeof window === "undefined") return;
  try {
    const toSave = messages.slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        version: CHAT_STORAGE_VERSION,
        messages: toSave,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Ignore storage errors
  }
}

function clearChatHistory(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}

// Helper to parse SSE events
function parseChatEvent(
  data: string,
): { type: "delta" | "error"; delta?: string; error?: unknown } | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function useChat(pathname: string) {
  const ux = useMemo(() => deriveChatUx(pathname), [pathname]);

  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [lastSendTime, setLastSendTime] = useState(0);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>(() => [
    {
      id: uid(),
      role: "assistant",
      content: ux.initialAssistantMessage,
    },
  ]);

  // Load history
  useEffect(() => {
    if (historyLoaded) return;
    const stored = loadChatHistory();
    if (stored && stored.length > 0) {
      setMessages(stored);
    }
    setHistoryLoaded(true);
  }, [historyLoaded]);

  // Save history
  useEffect(() => {
    if (!historyLoaded) return;
    if (messages.length > 1) {
      saveChatHistory(messages);
    }
  }, [messages, historyLoaded]);

  // Update initial message
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length !== 1) return prev;
      const first = prev[0];
      if (!first || first.role !== "assistant") return prev;
      if (first.content === ux.initialAssistantMessage) return prev;
      return [{ ...first, content: ux.initialAssistantMessage }];
    });
  }, [ux.initialAssistantMessage]);

  // Nudge timer
  useEffect(() => {
    const timer = window.setTimeout(() => setNudge(true), 15_000);
    return () => window.clearTimeout(timer);
  }, []);

  // External open event
  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setNudge(false);
    };
    window.addEventListener("elongoat:chat:open", handler as EventListener);
    return () =>
      window.removeEventListener(
        "elongoat:chat:open",
        handler as EventListener,
      );
  }, []);

  // Derived state
  const characterCount = input.length;
  const characterLimitReached = characterCount >= MAX_INPUT_CHARS;
  const canSend = useMemo(
    () =>
      input.trim().length > 0 &&
      !streaming &&
      !characterLimitReached &&
      Date.now() - lastSendTime > SEND_DEBOUNCE_MS,
    [input, streaming, characterLimitReached, lastSendTime],
  );

  const retryCountRef = useRef(0);

  const send = useCallback(
    async (text: string, isRetry = false) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const now = Date.now();
      if (now - lastSendTime < SEND_DEBOUNCE_MS && !isRetry) {
        return;
      }

      setOpen(true);
      setNudge(false);
      setStreaming(true);
      setNetworkError(null);
      setRetryMessage(null);
      setLastSendTime(now);

      const lastMsg = messages[messages.length - 1];
      const isRetryingError = lastMsg?.error && isRetry;

      let assistantMsg: ChatItem;

      if (isRetryingError) {
        assistantMsg = { ...lastMsg, content: "", error: undefined };
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? assistantMsg : m)),
        );
      } else {
        const userMsg: ChatItem = {
          id: uid(),
          role: "user",
          content: trimmed,
        };
        assistantMsg = {
          id: uid(),
          role: "assistant",
          content: "",
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }

      if (!isRetryingError) setInput("");

      try {
        const apiUrl = env.NEXT_PUBLIC_API_URL
          ? `${env.NEXT_PUBLIC_API_URL}/api/chat`
          : "/api/chat";

        // Set up timeout for streaming
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT);

        const res = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            context: { currentPage: getViewportLabel() },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          const msg =
            typeof err?.error === "string"
              ? err.error
              : "Chat error. Please retry.";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: msg, error: true }
                : m,
            ),
          );
          setNetworkError(msg);
          setRetryMessage(trimmed);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let lastChunkTime = Date.now();

        // Set up chunk timeout
        const chunkTimeoutMs = 15000; // 15 seconds without new data

        while (true) {
          const { value, done } = await reader.read();

          // Check for data timeout
          if (Date.now() - lastChunkTime > chunkTimeoutMs) {
            throw new Error("Stream timeout - no data received");
          }
          if (value) {
            lastChunkTime = Date.now();
          }

          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const lines = part.split("\n");
            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine.startsWith("data:")) continue;
              const data = trimmedLine.slice(5).trim();

              if (data === "[DONE]") break;
              if (!data) continue;

              try {
                const evt = parseChatEvent(data);
                if (!evt) continue;

                if (evt.type === "delta" && evt.delta) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, content: m.content + evt.delta }
                        : m,
                    ),
                  );
                }
                if (evt.type === "error") {
                  throw new Error("Upstream error");
                }
              } catch {
                // ignore
              }
            }
          }
        }

        // Reset retry count on success
        retryCountRef.current = 0;
      } catch (err) {
        const errorMsg =
          err instanceof Error
            ? err.message.includes("timeout") || err.message.includes("abort")
              ? "Connection timeout. Please try again."
              : err.message.includes("NetworkError") ||
                  err.message.includes("fetch")
                ? "Network error. Please check your connection."
                : "Something went wrong. Please try again."
            : "Network error. Please retry.";

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: errorMsg, error: true }
              : m,
          ),
        );
        setNetworkError(errorMsg);
        setRetryMessage(trimmed);

        // Auto-retry on retryable errors
        const isRetryableError =
          errorMsg.includes("timeout") ||
          errorMsg.includes("Network") ||
          errorMsg.includes("connection");

        if (isRetryableError && retryCountRef.current < MAX_RETRY_ATTEMPTS) {
          retryCountRef.current++;
          // Retry after a delay
          setTimeout(() => {
            send(text, true);
          }, 1000 * retryCountRef.current);
        }
      } finally {
        setStreaming(false);
        if (!isRetryingError && trimmed) {
          setFollowUpQuestions(getFollowUpQuestions(trimmed));
        }
      }
    },
    [lastSendTime, messages],
  );

  const clearChat = useCallback(() => {
    if (!showClearConfirm) {
      setShowClearConfirm(true);
      return;
    }
    clearChatHistory();
    setMessages([
      {
        id: uid(),
        role: "assistant",
        content: ux.initialAssistantMessage,
      },
    ]);
    setShowClearConfirm(false);
    setNetworkError(null);
    setRetryMessage(null);
    setFollowUpQuestions([]);
  }, [showClearConfirm, ux.initialAssistantMessage]);

  const resetClearConfirm = useCallback(() => {
    setShowClearConfirm(false);
  }, []);

  return {
    // State
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

    // Actions
    send,
    clearChat,
    resetClearConfirm,
    ux,
  };
}
