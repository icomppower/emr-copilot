import { LIVE_CASES } from "@/lib/cases";
import { llmConfig } from "@/lib/llm";

export const dynamic = "force-dynamic";

// What the UI needs to pick live vs scripted mode. Never includes the key.
export async function GET() {
  const cfg = llmConfig();
  return Response.json({
    live: cfg.configured && !cfg.demoMode,
    demoMode: cfg.demoMode,
    provider: cfg.baseUrl ? new URL(cfg.baseUrl).host : "",
    models: cfg.models,
    concurrency: Math.max(1, Math.min(20, Number(process.env.CASE_CONCURRENCY) || 4)),
    cases: LIVE_CASES.map((c) => c.id),
  });
}
