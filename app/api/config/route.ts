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
    cases: LIVE_CASES.map((c) => c.id),
  });
}
