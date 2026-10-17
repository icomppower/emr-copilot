import OpenAI, { APIError } from "openai";
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

// The only place that talks to a model. Swapping providers (Claude stand-in → Crusoe + Nemotron) is env-only:
// LLM_BASE_URL, LLM_API_KEY, and a model per role (LLM_MODEL_PLANNER / _WORKER / _VERIFIER, each falling back to LLM_MODEL).

export type Role = "planner" | "worker" | "verifier" | "reviewer";

export function llmConfig() {
  const fallback = process.env.LLM_MODEL || "";
  const models: Record<Role, string> = {
    planner: process.env.LLM_MODEL_PLANNER || fallback,
    worker: process.env.LLM_MODEL_WORKER || fallback,
    verifier: process.env.LLM_MODEL_VERIFIER || fallback,
    reviewer: process.env.LLM_MODEL_REVIEWER || process.env.LLM_MODEL_PLANNER || fallback,
  };
  return {
    configured: Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && models.planner && models.worker && models.verifier),
    demoMode: process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true",
    baseUrl: process.env.LLM_BASE_URL || "",
    models,
  };
}

// Per-model sampling params, matched on the model id. First match wins.
const MODEL_PARAMS: { match: RegExp; temperature?: number; top_p?: number; minMaxTokens?: number }[] = [
  { match: /nemotron/i, temperature: 1.0, top_p: 0.95, minMaxTokens: 4000 }, // NVIDIA's recommended settings; reasoning needs room
  { match: /claude|haiku|sonnet|opus/i }, // Claude 5 models reject temperature: send none
];

export function paramsFor(model: string, maxTokens: number) {
  const p: (typeof MODEL_PARAMS)[number] = MODEL_PARAMS.find((x) => x.match.test(model)) ?? { match: /$^/ };
  return {
    max_tokens: Math.max(maxTokens, p.minMaxTokens ?? 0),
    ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(p.top_p !== undefined ? { top_p: p.top_p } : {}),
  };
}

let client: OpenAI | null = null;
function getClient() {
  // SDK retries off: retryDelay() below handles 429/5xx with the provider's rate-limit headers.
  if (!client) client = new OpenAI({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, maxRetries: 0, timeout: 120_000 });
  return client;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 6;

// Seconds until the limit resets, from whichever header the provider sends:
// retry-after-ms, retry-after (seconds or HTTP date), x-ratelimit-reset-* ("1s", "6m0s", "250ms" or seconds), anthropic-ratelimit-*-reset (RFC 3339).
export function headerWaitMs(headers: Headers | undefined): number | null {
  if (!headers) return null;
  const ms = Number(headers.get("retry-after-ms"));
  if (ms > 0) return ms;
  const ra = headers.get("retry-after");
  if (ra) {
    const s = Number(ra);
    if (!Number.isNaN(s)) return s * 1000;
    const d = Date.parse(ra);
    if (!Number.isNaN(d)) return Math.max(0, d - Date.now());
  }
  const waits: number[] = [];
  headers.forEach((v, k) => {
    if (!/ratelimit.*reset/i.test(k)) return;
    const n = Number(v);
    if (!Number.isNaN(n)) return void waits.push(n * 1000);
    const iso = Date.parse(v);
    if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}/.test(v)) return void waits.push(Math.max(0, iso - Date.now()));
    const dur = [...v.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)].reduce((a, [, x, u]) => a + Number(x) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[u as "ms"]!, 0);
    if (dur > 0) waits.push(dur);
  });
  return waits.length ? Math.max(...waits) : null;
}

function retryDelay(e: unknown, attempt: number) {
  const fromHeader = e instanceof APIError ? headerWaitMs(e.headers as Headers | undefined) : null;
  const backoff = Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
  return Math.min(60_000, fromHeader != null ? fromHeader + 250 : backoff);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), rej(new Error("aborted"))), { once: true });
  });

export async function chat(
  role: Role,
  messages: ChatCompletionMessageParam[],
  opts: { tools?: ChatCompletionTool[]; forceTool?: string; maxTokens?: number; signal?: AbortSignal } = {},
): Promise<{ message: ChatCompletionMessage; ms: number }> {
  const model = llmConfig().models[role];
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await getClient().chat.completions.create(
        {
          model,
          messages,
          ...paramsFor(model, opts.maxTokens ?? 1200),
          ...(opts.tools ? { tools: opts.tools } : {}),
          ...(opts.forceTool ? { tool_choice: { type: "function" as const, function: { name: opts.forceTool } } } : {}),
        },
        { signal: opts.signal },
      );
      const message = res.choices[0]?.message;
      if (!message) throw new Error("Model returned no choices");
      return { message, ms: Date.now() - t0 };
    } catch (e) {
      const status = e instanceof APIError ? e.status : undefined;
      const retryable = (status !== undefined && RETRY_STATUS.has(status)) || (e instanceof APIError && status === undefined); // connection errors
      if (!retryable || attempt + 1 >= MAX_ATTEMPTS || opts.signal?.aborted) throw e;
      const wait = retryDelay(e, attempt);
      console.warn(`[llm] backoff role=${role} status=${status ?? "conn"} attempt=${attempt + 1} wait_ms=${Math.round(wait)}`);
      await sleep(wait, opts.signal);
    }
  }
}

// Models wrap JSON in prose or code fences often enough that every JSON reply goes through this.
export function parseJsonReply(text: string | null | undefined): unknown {
  if (!text) throw new Error("empty reply");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[{[]/);
  if (start < 0) throw new Error("no JSON object in reply");
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end <= start) throw new Error("unterminated JSON in reply");
  return JSON.parse(body.slice(start, end + 1));
}
