import OpenAI from "openai";
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

// The only place that talks to a model. Swapping providers (Claude stand-in → Crusoe + Nemotron)
// is env-only: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, and optionally LLM_MODEL_VERIFIER.

export type Role = "planner" | "worker" | "verifier";

export function llmConfig() {
  const model = process.env.LLM_MODEL || "";
  return {
    configured: Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && model),
    demoMode: process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true",
    baseUrl: process.env.LLM_BASE_URL || "",
    models: {
      planner: model,
      worker: model,
      verifier: process.env.LLM_MODEL_VERIFIER || model,
    } as Record<Role, string>,
  };
}

let client: OpenAI | null = null;
function getClient() {
  if (!client) client = new OpenAI({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, maxRetries: 2, timeout: 60_000 });
  return client;
}

export async function chat(
  role: Role,
  messages: ChatCompletionMessageParam[],
  opts: { tools?: ChatCompletionTool[]; forceTool?: string; maxTokens?: number; signal?: AbortSignal } = {},
): Promise<{ message: ChatCompletionMessage; ms: number }> {
  const t0 = Date.now();
  const res = await getClient().chat.completions.create(
    {
      model: llmConfig().models[role],
      messages,
      max_tokens: opts.maxTokens ?? 1200,
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.forceTool ? { tool_choice: { type: "function" as const, function: { name: opts.forceTool } } } : {}),
    },
    { signal: opts.signal },
  );
  const message = res.choices[0]?.message;
  if (!message) throw new Error("Model returned no choices");
  return { message, ms: Date.now() - t0 };
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
