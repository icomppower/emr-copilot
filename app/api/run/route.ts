import { runBacklog, type RunEvent } from "@/lib/agent";
import { LIVE_CASES } from "@/lib/cases";
import { llmConfig } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

// Streams the live run as Server-Sent Events. The UI reads it with fetch (not EventSource),
// so a finished stream never auto-reconnects into a second run.
export async function GET(req: Request) {
  const cfg = llmConfig();
  if (!cfg.configured || cfg.demoMode) {
    return Response.json({ error: cfg.demoMode ? "DEMO_MODE is on" : "LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set" }, { status: 409 });
  }
  const url = new URL(req.url);
  const only = url.searchParams.get("cases")?.split(",").filter(Boolean);
  const cases = only?.length ? LIVE_CASES.filter((c) => only.includes(c.id)) : LIVE_CASES;
  // Cases in flight at once: CASE_CONCURRENCY (default 4), overridable per request with ?parallel=.
  const parallel = Math.max(1, Math.min(20, Number(url.searchParams.get("parallel")) || Number(process.env.CASE_CONCURRENCY) || 4));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (e: RunEvent | { type: "ping" }) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify({ ...e, t: Date.now() })}\n\n`));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => send({ type: "ping" }), 15_000);
      try {
        await runBacklog(cases, send, req.signal, parallel, cfg.models);
      } catch (e) {
        if (!req.signal.aborted) send({ type: "error", message: (e as Error).message });
      } finally {
        clearInterval(ping);
        open = false;
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
