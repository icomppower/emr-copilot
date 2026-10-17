import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { RUN_GOAL, type LiveCase } from "./cases";
import { chat, parseJsonReply } from "./llm";
import { registryFor, runTool, toolsFor, validateArgs, type ToolCtx } from "./tools";

export const MAX_REPLANS = 2;
export const MAX_STEPS = 12;
export const MAX_SAME_CALL = 3;

export interface ChecklistItem { id: string; check: string; evidence: string }
export interface Verdict { check: string; pass: boolean; reason: string }

export type RunEvent =
  | { type: "run_start"; goal: string; cases: string[]; models: Record<string, string>; parallel: number }
  | { type: "delegated"; caseId: string; agent: string }
  | { type: "checklist"; caseId: string; items: ChecklistItem[]; ms: number }
  | { type: "tool_call"; caseId: string; tool: string; args: unknown; status: "ok" | "error" | "invalid"; result: unknown; step: number }
  | { type: "check_result"; caseId: string; round: number; pass: boolean; verdicts: Verdict[]; ms: number }
  | { type: "replan"; caseId: string; round: number; failed: Verdict[] }
  | { type: "loop_detected"; caseId: string; reason: string }
  | { type: "escalated"; caseId: string; reason: string; by: "rule" | "agent" | "loop" | "verifier" | "error" }
  | { type: "closed"; caseId: string; summary: string; value: number; released: string[] }
  | { type: "error"; caseId?: string; message: string }
  | { type: "run_end"; closed: number; escalated: number; ms: number };

export type Emit = (e: RunEvent) => void;

const SAFETY = "Administrative work only. Never give medical advice, never interpret clinical results, never sign or attest for a physician. Anything clinical or needing a signature goes to staff.";

// ---------- Planner ----------
async function plan(c: LiveCase, signal: AbortSignal): Promise<{ items: ChecklistItem[]; ms: number }> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are the Planner for a clinic back office. Turn a case goal into a done-checklist: 3 to 5 checks that a Verifier can decide as pass/fail purely from tool results and the chart. ` +
        `Each check is one concrete, observable condition (e.g. "submitted claim's referring NPI belongs to the referring provider's specialty in the registry"). No vague items like "work is accurate". ${SAFETY}\n` +
        `Reply with ONLY JSON: {"checklist":[{"id":"c1","check":"...","evidence":"which tool result or chart field proves it"}]}`,
    },
    {
      role: "user",
      content: `Run goal: ${RUN_GOAL}\nCase ${c.id} (${c.agent}): ${c.goal}\nTools the worker will have: ${toolsFor(c.agent).map((t) => (t.type === "function" ? t.function.name : "")).join(", ")}`,
    },
  ];
  let ms = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await chat("planner", messages, { signal, maxTokens: 900 });
    ms += r.ms;
    try {
      const parsed = parseJsonReply(r.message.content) as { checklist?: unknown };
      const list = parsed.checklist;
      if (!Array.isArray(list) || list.length < 3 || list.length > 5) throw new Error("checklist must be an array of 3 to 5 items");
      const items = list.map((x, i) => {
        const o = x as Partial<ChecklistItem>;
        if (typeof o.check !== "string" || !o.check.trim()) throw new Error(`item ${i + 1} has no "check" string`);
        return { id: typeof o.id === "string" && o.id ? o.id : `c${i + 1}`, check: o.check.trim(), evidence: typeof o.evidence === "string" ? o.evidence : "" };
      });
      return { items, ms };
    } catch (e) {
      if (attempt === 2) throw new Error(`Planner checklist invalid twice: ${(e as Error).message}`);
      messages.push({ role: "assistant", content: r.message.content || "" }, { role: "user", content: `Invalid: ${(e as Error).message}. Reply with ONLY the JSON object.` });
    }
  }
  throw new Error("unreachable");
}

// ---------- Verifier ----------
async function verify(c: LiveCase, items: ChecklistItem[], ctx: ToolCtx, log: unknown[], signal: AbortSignal): Promise<{ verdicts: Verdict[]; ms: number }> {
  const evidence = JSON.stringify({ tool_log: log, outbound_gate: ctx.outbox });
  const chart = ctx.chartSeen || c.chart;
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are the Verifier. You did not do the work and you do not trust the worker's claims. Judge each checklist item ONLY against the chart, the tool log, what sits at the outbound gate, and the NPI registry (the registry is authoritative for provider identity and specialty). ` +
        `Pass an item only if the evidence clearly shows it. If something was never done, it fails. ${SAFETY}\n` +
        `Reply with ONLY JSON: {"verdicts":[{"check":"<the checklist item text>","pass":true|false,"reason":"<one sentence citing the evidence>"}]} with exactly one verdict per checklist item, in order.`,
    },
    {
      role: "user",
      content:
        `Case ${c.id}: ${c.goal}\nChecklist:\n${items.map((x, i) => `${i + 1}. ${x.check}`).join("\n")}\n\n` +
        `Chart (current):\n${JSON.stringify(chart)}\n\nNPI registry records:\n${JSON.stringify(registryFor(evidence + JSON.stringify(chart)))}\n\nEvidence:\n${evidence}`,
    },
  ];
  let ms = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await chat("verifier", messages, { signal, maxTokens: 1500 });
    ms += r.ms;
    try {
      const parsed = parseJsonReply(r.message.content) as { verdicts?: unknown };
      const v = parsed.verdicts;
      if (!Array.isArray(v) || v.length !== items.length) throw new Error(`need exactly ${items.length} verdicts`);
      const verdicts = v.map((x, i) => {
        const o = x as Partial<Verdict>;
        if (typeof o.pass !== "boolean") throw new Error(`verdict ${i + 1}: "pass" must be true or false`);
        if (typeof o.reason !== "string" || !o.reason.trim()) throw new Error(`verdict ${i + 1}: "reason" is required`);
        return { check: typeof o.check === "string" && o.check ? o.check : items[i].check, pass: o.pass, reason: o.reason.trim() };
      });
      return { verdicts, ms };
    } catch (e) {
      if (attempt === 2) return { verdicts: items.map((x) => ({ check: x.check, pass: false, reason: `Verifier output unusable: ${(e as Error).message}` })), ms };
      messages.push({ role: "assistant", content: r.message.content || "" }, { role: "user", content: `Invalid: ${(e as Error).message}. Reply with ONLY the JSON object.` });
    }
  }
  throw new Error("unreachable");
}

// ---------- one case, end to end ----------
export async function runCase(c: LiveCase, emit: Emit, signal: AbortSignal): Promise<"closed" | "escalated"> {
  const escalate = (reason: string, by: Extract<RunEvent, { type: "escalated" }>["by"]) => {
    emit({ type: "escalated", caseId: c.id, reason, by });
    return "escalated" as const;
  };
  try {
    emit({ type: "delegated", caseId: c.id, agent: c.agent });
    const { items, ms } = await plan(c, signal);
    emit({ type: "checklist", caseId: c.id, items, ms });

    const ctx: ToolCtx = { c, round: 0, calls: {}, chartSeen: null, outbox: [] };
    const tools = toolsFor(c.agent);
    const seen = new Map<string, number>();
    const log: { tool: string; args: unknown; result: unknown }[] = [];
    let steps = 0;
    let invalidStreak = 0;
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          `You are the ${c.agent} worker agent at Sunrise Family Medicine. Complete the case with your tools; never invent facts a tool did not return. ${SAFETY} ` +
          `If something must go to staff, call escalate_to_staff. A Verifier will check your work against the checklist before anything leaves the clinic. When finished, reply with a one-sentence summary and no tool call.`,
      },
      { role: "user", content: `Case ${c.id}: ${c.goal}\nDone-checklist:\n${items.map((x, i) => `${i + 1}. ${x.check}`).join("\n")}` },
    ];

    for (;;) {
      // ---- worker acts until it stops calling tools ----
      let summary = "";
      for (;;) {
        const { message } = await chat("worker", messages, { tools, signal, maxTokens: 1000 });
        const calls = (message.tool_calls || []).filter((t) => t.type === "function");
        messages.push({ role: "assistant", content: message.content || "", ...(calls.length ? { tool_calls: calls } : {}) });
        if (!calls.length) {
          summary = (message.content || "").trim();
          break;
        }
        let stop: "closed" | "escalated" | null = null;
        for (const call of calls) {
          if (stop) {
            messages.push({ role: "tool", tool_call_id: call.id, content: "Not run: case stopped." });
            continue;
          }
          const name = call.function.name;
          const v = validateArgs(c.agent, name, call.function.arguments);
          if ("error" in v) {
            invalidStreak++;
            emit({ type: "tool_call", caseId: c.id, tool: name, args: call.function.arguments, status: "invalid", result: v.error, step: steps });
            messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: invalid tool call: ${v.error} Fix the arguments and call again.` });
            if (invalidStreak >= 2) stop = escalate(`Worker produced invalid tool calls twice in a row (${v.error}).`, "loop");
            continue;
          }
          invalidStreak = 0;
          steps++;
          const key = name + JSON.stringify(v.args, Object.keys(v.args).sort());
          const count = (seen.get(key) || 0) + 1;
          seen.set(key, count);
          if (count >= MAX_SAME_CALL || steps > MAX_STEPS) {
            const reason = count >= MAX_SAME_CALL ? `${name} called ${count}× with identical arguments` : `step cap of ${MAX_STEPS} reached`;
            emit({ type: "loop_detected", caseId: c.id, reason });
            const last = log.filter((l) => l.tool === name).pop();
            const detail = last && typeof last.result === "object" && last.result && "error" in last.result ? ` Last result: ${String((last.result as { error: string }).error)}` : "";
            messages.push({ role: "tool", tool_call_id: call.id, content: "Not run: loop detector stopped the case." });
            stop = escalate(`Loop detector stopped the case: ${reason}.${detail} Staff to finish it.`, "loop");
            continue;
          }
          if (name === "escalate_to_staff") {
            emit({ type: "tool_call", caseId: c.id, tool: name, args: v.args, status: "ok", result: { routed: "staff tray" }, step: steps });
            messages.push({ role: "tool", tool_call_id: call.id, content: "Routed to staff." });
            stop = escalate(String(v.args.reason), "agent");
            continue;
          }
          const r = runTool(ctx, name, v.args);
          const result = r.ok ? r.data : { error: r.error };
          log.push({ tool: name, args: v.args, result });
          emit({ type: "tool_call", caseId: c.id, tool: name, args: v.args, status: r.ok ? "ok" : "error", result, step: steps });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
          if (r.ok && typeof r.data.requires_human === "string") {
            // Hard rule, not a model decision: clinical or signature items stop here, unassessed.
            stop = escalate(r.data.requires_human, "rule");
          }
        }
        if (stop) return stop;
      }

      // ---- Verifier runs the checklist ----
      const { verdicts, ms: vms } = await verify(c, items, ctx, log, signal);
      const pass = verdicts.every((v) => v.pass);
      emit({ type: "check_result", caseId: c.id, round: ctx.round + 1, pass, verdicts, ms: vms });
      if (pass) {
        emit({ type: "closed", caseId: c.id, summary: summary || "All checks passed.", value: c.value, released: ctx.outbox.map((o) => o.reference) });
        return "closed";
      }
      const failed = verdicts.filter((v) => !v.pass);
      if (ctx.round >= MAX_REPLANS) return escalate(`Still failing after ${MAX_REPLANS} re-plans: ${failed.map((f) => f.reason).join(" ")}`, "verifier");
      ctx.round++;
      emit({ type: "replan", caseId: c.id, round: ctx.round, failed });
      messages.push({
        role: "user",
        content:
          `The Verifier failed ${failed.length} check(s). Nothing has left the clinic. Re-plan and fix only these, using your tools to get correct data:\n` +
          failed.map((f) => `- ${f.check}: ${f.reason}`).join("\n") +
          `\nIf a previous submission was wrong, submit a corrected one. Then reply with a one-sentence summary.`,
      });
    }
  } catch (e) {
    if (signal.aborted) throw e;
    const message = (e as Error).message || String(e);
    emit({ type: "error", caseId: c.id, message });
    return escalate(`Agent error: ${message.slice(0, 160)}`, "error");
  }
}

// ---------- whole backlog ----------
export async function runBacklog(cases: LiveCase[], emit: Emit, signal: AbortSignal, parallel = 4, models: Record<string, string> = {}) {
  const t0 = Date.now();
  emit({ type: "run_start", goal: RUN_GOAL, cases: cases.map((c) => c.id), models, parallel });
  const queue = [...cases];
  let closed = 0;
  let escalated = 0;
  await Promise.all(
    Array.from({ length: Math.min(parallel, cases.length) }, async () => {
      while (queue.length && !signal.aborted) {
        const c = queue.shift()!;
        const r = await runCase(c, emit, signal).catch(() => null);
        if (r === "closed") closed++;
        else if (r === "escalated") escalated++;
      }
    }),
  );
  if (!signal.aborted) emit({ type: "run_end", closed, escalated, ms: Date.now() - t0 });
}
