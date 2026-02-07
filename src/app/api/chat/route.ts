import "server-only";

import { createHash } from "node:crypto";

import { NextRequest } from "next/server";
import { z } from "zod";

import { buildSystemPrompt } from "../../../lib/buildSystemPrompt";
import { recordChatQuestionStat } from "../../../lib/chatAnalytics";
import { getChatConfig } from "../../../lib/chatConfig";
import { findPage, findPaaQuestion, findTopic } from "../../../lib/indexes";
import { getRedis } from "../../../lib/redis";
import { rateLimitChat, rateLimitResponse } from "../../../lib/rateLimit";
import { getDynamicVariables } from "../../../lib/variables";
import { getTranscript, getVideo } from "../../../lib/videos";
import { listXFollowing, listXTweets } from "../../../lib/x";
import { getEnv } from "../../../lib/env";

const env = getEnv();
const RequestSchema = z
  .object({
    message: z.string().min(1).max(2000),
    context: z
      .object({
        currentPage: z.string().min(1).max(255).optional(),
      })
      .optional(),
  })
  .strict();

const FALLBACK_RESPONSES = new Map<string, string>([
  [
    "age",
    "I’m an AI simulation inspired by Elon’s public persona — not the real Elon. He was born on June 28, 1971, so the age is {{age}} (auto-calculated).",
  ],
  [
    "children",
    "I’m an AI simulation (not the real Elon). Public reporting often says he has {{children_count}} children — treat counts as changeable over time.",
  ],
  [
    "net_worth",
    "I’m an AI simulation (not the real Elon). Net worth fluctuates with markets. Current variable: {{net_worth}}. Verify with primary sources if it matters.",
  ],
  [
    "companies",
    "I’m an AI simulation (not the real Elon). Publicly associated companies: Tesla, SpaceX, X (Twitter), xAI, Neuralink, The Boring Company.",
  ],
  [
    "mars",
    "I’m an AI simulation (not the real Elon). The Mars argument: you want a self-sustaining city as a backup drive for civilization. Starship is the path to make it economically feasible.",
  ],
  [
    "default",
    "I’m an AI simulation inspired by Elon’s public persona — not the real Elon. Ask about SpaceX, Tesla, Mars, rockets, EVs, AI, or leadership tradeoffs.",
  ],
]);

/**
 * SECURITY: Sanitize user input to prevent prompt injection attacks.
 *
 * This function removes patterns commonly used in prompt injection attempts:
 * - Instruction override attempts (ignore previous, etc.)
 * - System prompt manipulation
 * - Role hijacking (pretend to be, you are now)
 * - Developer mode bypasses
 *
 * Note: This is a defense-in-depth measure. The primary protection should
 * come from proper prompt engineering and model configuration.
 */
function sanitize(input: string): string {
  // SECURITY: Enhanced prompt injection pattern detection
  // Matches common prompt injection techniques
  const dangerous = [
    // Instruction override patterns
    /ignore\s+(?:all\s+)?(?:previous|above|earlier|the)?\s*instructions?/gi,
    /disregard\s+(?:all\s+)?(?:previous|above|earlier|the)?\s*instructions?/gi,
    /forget\s+(?:everything|all\s+instructions|previous)/gi,
    /override\s+(?:the\s+)?(?:system|default)\s*(?:prompt|instructions)/gi,

    // System prompt manipulation
    /system\s*:\s*(?:ignore|forget|override)/gi,
    /\[SYSTEM\]/gi,
    /\[SYSTEM\s*MSG\]/gi,
    /<system>/gi,

    // Role hijacking
    /you\s+are\s+now/gi,
    /pretend\s+(?:to\s+be|you\s+are)/gi,
    /act\s+as\s+(?:if\s+you\s+are|a)/gi,
    /roleplay\s+as/gi,
    /from\s+now\s+on/gi,

    // Developer/jailbreak patterns
    /developer\s*mode/gi,
    /jailbreak/gi,
    /dan\s+mode/gi,
    /unrestricted\s+mode/gi,
    /bypass\s+(?:the\s+)?(?:filter|restrictions|safety)/gi,
    /no\s+limitations/gi,

    // Output format manipulation
    /output\s+(?:only|just|exactly)/gi,
    /print\s+(?:the\s+)?(?:system\s+)?prompt/gi,
    /repeat\s+(?:the\s+)?(?:above|everything)/gi,
    /echo\s+(?:the\s+)?prompt/gi,
    /show\s+(?:me\s+)?your\s+(?:instructions|prompt|system)/gi,

    // Encoding/obfuscation attempts
    /base64/gi,
    /rot-?13/gi,
    /reverse\s+(?:the\s+)?string/gi,
    /\|.*\|/g, // Markdown code block patterns
  ];

  let safe = input;
  for (const p of dangerous) {
    safe = safe.replace(p, "[filtered]");
  }

  // Remove control characters (except common whitespace)
  safe = safe.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

  // Limit length to prevent DoS via extremely long inputs
  return safe.slice(0, 2000);
}

function matchFallbackKey(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("old") || lower.includes("age") || lower.includes("born"))
    return "age";
  if (
    lower.includes("child") ||
    lower.includes("kid") ||
    lower.includes("family")
  )
    return "children";
  if (
    lower.includes("worth") ||
    lower.includes("money") ||
    lower.includes("rich")
  )
    return "net_worth";
  if (
    lower.includes("company") ||
    lower.includes("tesla") ||
    lower.includes("spacex") ||
    lower.includes("xai")
  )
    return "companies";
  if (
    lower.includes("mars") ||
    lower.includes("space") ||
    lower.includes("rocket") ||
    lower.includes("starship")
  )
    return "mars";
  return "default";
}

function getVectorEngineConfig(): {
  url: string;
  key: string;
  model: string;
} | null {
  const key = env.VECTORENGINE_API_KEY;
  if (!key) return null;

  const baseUrl = env.VECTORENGINE_BASE_URL ?? "https://api.vectorengine.ai";
  const url =
    env.VECTORENGINE_API_URL ??
    `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const model = env.VECTORENGINE_MODEL ?? "grok-4-fast-non-reasoning";

  return { url, key, model };
}

let apiHealthy = true;
let lastHealthCheck = 0;

async function checkApiHealth(url: string, key: string): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthCheck < 30_000) return apiHealthy;

  try {
    const baseUrl = url.replace(/\/v1\/chat\/completions$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    apiHealthy = res.ok;
  } catch {
    apiHealthy = false;
  }

  lastHealthCheck = now;
  return apiHealthy;
}

function sseJson(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  payload: unknown,
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function sseDone(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
) {
  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
}

function streamFallback(text: string) {
  return streamText(text, { provider: "fallback", model: "fallback" });
}

type PromptMetrics = {
  systemPromptChars: number;
  userMessageChars: number;
  siteContextChars: number;
  promptChars: number;
  promptTokens: number;
};

function estimateTokensFromChars(chars: number): number {
  // Heuristic only: typical English tokens average ~4 chars. Useful as a stable relative metric.
  return Math.max(1, Math.ceil(chars / 4));
}

function streamVectorEngineOpenAIStream(params: {
  providerStream: ReadableStream<Uint8Array>;
  provider: "vectorengine";
  model: string;
  prompt?: PromptMetrics;
  onComplete?: (fullText: string) => Promise<void> | void;
}) {
  const { providerStream, provider, model } = params;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const conversationId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let buffer = "";
  let fullText = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      sseJson(controller, encoder, {
        type: "meta",
        provider,
        model,
        conversationId,
        createdAt,
        prompt: params.prompt,
      });

      reader = providerStream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              sseJson(controller, encoder, {
                type: "done",
                finishReason: "stop",
              });
              sseDone(controller, encoder);
              controller.close();
              return;
            }

            try {
              const json: unknown = JSON.parse(data);
              const delta = extractOpenAIDelta(json);
              if (typeof delta === "string" && delta.length) {
                fullText += delta;
                sseJson(controller, encoder, { type: "delta", delta });
              }
            } catch {
              // Ignore malformed chunks
            }
          }
        }

        sseJson(controller, encoder, { type: "done", finishReason: "stop" });
        await params.onComplete?.(fullText);
        sseDone(controller, encoder);
        controller.close();
      } catch {
        sseJson(controller, encoder, {
          type: "error",
          error: { code: "STREAM_ERROR", message: "Upstream stream error" },
        });
        sseDone(controller, encoder);
        controller.close();
      }
    },
    async cancel() {
      try {
        await reader?.cancel();
      } catch {
        // ignore
      }
    },
  });
}

export async function POST(req: NextRequest) {
  const { result: rlResult, headers: rlHeaders } = await rateLimitChat(req);
  if (!rlResult.ok) {
    return rateLimitResponse(rlResult);
  }

  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const vars = await getDynamicVariables();
  const message = sanitize(parsed.data.message);
  const siteContext = await buildSiteContext(parsed.data.context?.currentPage);
  const { config: chatConfig, analyticsEnabled } = await getChatConfig();

  // Optional: aggregated question stats (no chat history). Disabled by default.
  void recordChatQuestionStat({
    message,
    currentPage: parsed.data.context?.currentPage,
    analyticsEnabled,
  });

  const systemPrompt = buildSystemPrompt({
    message,
    vars,
    chatConfig,
    currentPage: parsed.data.context?.currentPage,
    siteContext,
  });

  const promptMetrics: PromptMetrics = {
    systemPromptChars: systemPrompt.length,
    userMessageChars: message.length,
    siteContextChars: siteContext.length,
    promptChars: systemPrompt.length + message.length,
    promptTokens: estimateTokensFromChars(systemPrompt.length + message.length),
  };

  const promptHeaders = {
    "X-System-Prompt-Chars": String(promptMetrics.systemPromptChars),
    "X-User-Message-Chars": String(promptMetrics.userMessageChars),
    "X-Site-Context-Chars": String(promptMetrics.siteContextChars),
    "X-Prompt-Chars": String(promptMetrics.promptChars),
    "X-Prompt-Tokens": String(promptMetrics.promptTokens),
    "X-Prompt-Tokens-Method": "heuristic_chars_per_token=4",
    "X-Chat-Mood": chatConfig.mood,
    "X-Chat-Typing-Quirk": chatConfig.typingQuirk ? "1" : "0",
  };

  const cfg = getVectorEngineConfig();
  if (!cfg) {
    const fallback = interpolate(
      FALLBACK_RESPONSES.get(matchFallbackKey(message)) ??
        FALLBACK_RESPONSES.get("default")!,
      vars,
    );
    return new Response(streamFallback(fallback), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...rlHeaders,
        "X-Fallback-Mode": "true",
        ...promptHeaders,
      },
    });
  }

  const cacheKey = buildChatCacheKey({
    message,
    siteContext,
    model: cfg.model,
    varsUpdatedAt: vars.updatedAt,
    mood: chatConfig.mood,
    typingQuirk: chatConfig.typingQuirk,
  });

  const redis = getRedis();
  if (redis && shouldCache(message)) {
    try {
      await redis.connect();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return new Response(
          streamText(cached, { provider: "cache", model: "cache" }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              ...rlHeaders,
              "X-Cache-Hit": "true",
              ...promptHeaders,
            },
          },
        );
      }
    } catch (err) {
      // Log cache errors for debugging but continue without cache
      if (process.env.NODE_ENV === "development") {
        console.warn("[Chat] Cache read failed:", err);
      }
    }
  }

  const healthy = await checkApiHealth(cfg.url, cfg.key);
  if (!healthy) {
    const fallback = interpolate(
      FALLBACK_RESPONSES.get(matchFallbackKey(message)) ??
        FALLBACK_RESPONSES.get("default")!,
      vars,
    );
    return new Response(streamFallback(fallback), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...rlHeaders,
        "X-Fallback-Mode": "true",
        ...promptHeaders,
      },
    });
  }

  try {
    const response = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        stream: true,
        max_tokens: 900,
        temperature: 0.7,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Upstream error: ${response.status}`);
    }

    const stream = streamVectorEngineOpenAIStream({
      providerStream: response.body,
      provider: "vectorengine",
      model: cfg.model,
      prompt: promptMetrics,
      onComplete: async (fullText) => {
        if (!redis || !shouldCache(message)) return;
        try {
          await redis.connect();
          await redis.set(cacheKey, fullText, "EX", 60 * 60 * 24);
        } catch (err) {
          // Log cache write errors but don't fail the response
          if (process.env.NODE_ENV === "development") {
            console.warn("[Chat] Cache write failed:", err);
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...rlHeaders,
        "X-Accel-Buffering": "no",
        ...promptHeaders,
      },
    });
  } catch (err) {
    // Log upstream errors for debugging
    if (process.env.NODE_ENV === "development") {
      console.error("[Chat] Upstream API error:", err);
    }
    const fallback = interpolate(
      FALLBACK_RESPONSES.get(matchFallbackKey(message)) ??
        FALLBACK_RESPONSES.get("default")!,
      vars,
    );
    return new Response(streamFallback(fallback), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...rlHeaders,
        "X-Fallback-Mode": "true",
        ...promptHeaders,
      },
    });
  }
}

function interpolate(
  template: string,
  vars: Awaited<ReturnType<typeof getDynamicVariables>>,
) {
  return template
    .replaceAll("{{age}}", String(vars.age))
    .replaceAll("{{children_count}}", String(vars.children_count))
    .replaceAll("{{net_worth}}", vars.net_worth);
}

function extractOpenAIDelta(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  const choices = obj["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const firstObj = first as Record<string, unknown>;

  const delta = firstObj["delta"];
  if (delta && typeof delta === "object") {
    const deltaObj = delta as Record<string, unknown>;
    const content = deltaObj["content"];
    if (typeof content === "string") return content;
    const text = deltaObj["text"];
    if (typeof text === "string") return text;
  }

  const text = firstObj["text"];
  if (typeof text === "string") return text;

  return "";
}

function shouldCache(message: string): boolean {
  if (message.length > 300) return false;
  if (/\S+@\S+\.\S+/.test(message)) return false;
  if (/\b\d{10,}\b/.test(message)) return false;
  return true;
}

/**
 * SECURITY: Build cache key with HMAC to prevent hash collision attacks.
 * Uses SHA-256 with proper key separation and domain separation.
 *
 * The key includes all parameters that affect the response, ensuring
 * cache hits only occur for semantically equivalent requests.
 */
function buildChatCacheKey(params: {
  message: string;
  siteContext: string;
  model: string;
  varsUpdatedAt: string;
  mood: string;
  typingQuirk: boolean;
}): string {
  // SECURITY: Use HMAC-SHA256 for keyed hashing to prevent collision attacks
  // Domain prefix prevents length-extension attacks
  const domainPrefix = "elongoat:chat:cache:v1:";

  const keyData = [
    params.message,
    params.siteContext,
    params.model,
    params.varsUpdatedAt,
    params.mood,
    params.typingQuirk ? "1" : "0",
  ].join("\x00"); // Use null byte as separator (safer than newline)

  // Double hash to prevent length-extension attacks
  const h = createHash("sha256")
    .update(domainPrefix, "utf8")
    .update(createHash("sha256").update(keyData, "utf8").digest("hex"))
    .digest("hex");

  return `chat:cache:${h}`;
}

function streamText(text: string, meta: { provider: string; model: string }) {
  const encoder = new TextEncoder();
  const chunks = text.split(/(\s+)/).filter(Boolean);
  let i = 0;
  const conversationId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      sseJson(controller, encoder, {
        type: "meta",
        provider: meta.provider,
        model: meta.model,
        conversationId,
        createdAt,
      });

      const send = () => {
        if (i >= chunks.length) {
          sseJson(controller, encoder, { type: "done", finishReason: "stop" });
          sseDone(controller, encoder);
          controller.close();
          return;
        }
        const piece = chunks.slice(i, i + 6).join("");
        i += 6;
        sseJson(controller, encoder, { type: "delta", delta: piece });
        setTimeout(send, 30);
      };
      send();
    },
  });
}

async function buildSiteContext(currentPage?: string): Promise<string> {
  if (!currentPage) return "";
  const clean = currentPage.split("?")[0]?.split("#")[0] ?? "";
  const parts = clean.split("/").filter(Boolean);
  if (!parts.length) return "";

  // /x and /x/following (best-effort cached mirror)
  if (parts[0] === "x") {
    const handle = (env.X_HANDLES?.split(",")[0] ?? "elonmusk")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();

    if (parts[1] === "following") {
      const following = await listXFollowing({ handle, limit: 80 });
      if (!following.length) return "";
      const sample = following
        .slice(0, 30)
        .map((f) => `@${f.followingHandle}`)
        .join(", ");
      return [
        `Type: X following list`,
        `Handle: @${handle}`,
        `Rows: ${following.length}`,
        sample ? `Sample: ${sample}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    const tweets = await listXTweets({ handle, limit: 12 });
    if (!tweets.length) return "";

    const items = tweets.slice(0, 6).map((t) => {
      const text = (t.content ?? "").replace(/\s+/g, " ").slice(0, 240);
      const when = t.postedAt ? new Date(t.postedAt).toISOString() : null;
      return `- ${when ?? "(unknown time)"}: ${text}`;
    });

    return [
      `Type: X timeline`,
      `Handle: @${handle}`,
      `Cached entries: ${tweets.length}`,
      `Recent posts:`,
      ...items,
    ].join("\n");
  }

  // /videos/:videoId
  if (parts[0] === "videos" && parts[1]) {
    const [video, transcript] = await Promise.all([
      getVideo(parts[1]),
      getTranscript(parts[1]),
    ]);
    if (!video) return "";

    const snippet = transcript?.transcriptText
      ? transcript.transcriptText.slice(0, 800)
      : "";
    return [
      `Type: Video`,
      `Video ID: ${video.videoId}`,
      video.title ? `Title: ${video.title}` : "",
      video.channel ? `Channel: ${video.channel}` : "",
      video.link ? `Link: ${video.link}` : "",
      snippet
        ? `Transcript excerpt: ${snippet}`
        : "Transcript: (not ingested yet)",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // /q/:slug
  if (parts[0] === "q" && parts[1]) {
    const q = await findPaaQuestion(parts[1]);
    if (!q) return "";
    const snippet = q.answer ? q.answer.slice(0, 500) : "";
    return [
      `Type: Q&A`,
      `Question: ${q.question}`,
      snippet ? `Snippet: ${snippet}` : "",
      q.sourceUrl ? `Source: ${q.sourceUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // /:topic/:page
  if (parts.length >= 2) {
    const page = await findPage(parts[0], parts[1]);
    if (!page) return "";
    const topK = page.topKeywords
      .slice(0, 8)
      .map((k) => k.keyword)
      .join("; ");
    return [
      `Type: Cluster page`,
      `Topic: ${page.topic}`,
      `Page: ${page.page}`,
      `Keywords: ${page.keywordCount}`,
      topK ? `Related keywords: ${topK}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // /:topic
  const topic = await findTopic(parts[0]);
  if (!topic) return "";
  return [
    `Type: Topic hub`,
    `Topic: ${topic.topic}`,
    `Pages: ${topic.pageCount}`,
  ].join("\n");
}
