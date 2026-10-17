import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { RUN_GOAL, type LiveCase } from "./cases";
import { chat, parseJsonReply } from "./llm";
import { loadPlaybook, type Playbook } from "./playbook";
import { REGISTRY } from "./cases";
import { registryFor, runTool, toolsFor, validateArgs, type ToolCtx } from "./tools";

export const MAX_REPLANS = 2;
export const MAX_STEPS = 12;
export const MAX_SAME_CALL = 3;

export interface ChecklistItem { id: string; check: string; evidence: string }
export interface Verdict { check: string; pass: boolean; reason: string }

export type RunEvent =
  | { type: "run_start"; goal: string; cases: string[]; models: Record<string, string>; parallel: number; playbook: number }
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

const SAFETY =
  "Administrative work only: never give medical advice, never interpret clinical results, never sign or attest for a physician. " +
  "Copying documents, flags, codes or documented values from the chart into a packet or request is administrative and allowed. " +
  "If a tool result contains requires_human, the case goes to staff.";
const ENV =
  "Synthetic environment: today is 2026-10-16 and every tool action happens today. NPIs are masked as ••NNNN and that is their complete, valid form. " +
  "Tool results are the only data that exists; never require fields the tools don't return (no DOB, MRN, prescriber NPI, quantities unless shown). " +
  "Chart coding notes and payer criteria are authoritative; \"no special criteria\" means nothing extra is required. A failed call followed by a successful retry is normal.";

// Verdicts come back as forced tool-call arguments: the SDK delivers them as escaped JSON, which free text often isn't.
const VERDICT_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_verdicts",
    description: "Return exactly one verdict per checklist item, in checklist order.",
    parameters: {
      type: "object",
      properties: {
        verdicts: {
          type: "array",
          items: { type: "object", properties: { check: { type: "string" }, pass: { type: "boolean" }, reason: { type: "string" } }, required: ["check", "pass", "reason"] },
        },
      },
      required: ["verdicts"],
    },
  },
};

const CHECKLIST_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "submit_checklist",
    description: "Return the done-checklist: 3 to 5 items.",
    parameters: {
      type: "object",
      properties: {
        checklist: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, check: { type: "string" }, evidence: { type: "string" } }, required: ["id", "check", "evidence"] },
        },
      },
      required: ["checklist"],
    },
  },
};

// Planner and Verifier output goes through a forced tool call, validated, with one retry carrying the error.
export async function structured<T>(
  role: "planner" | "verifier" | "reviewer",
  messages: ChatCompletionMessageParam[],
  tool: ChatCompletionTool,
  maxTokens: number,
  signal: AbortSignal,
  validate: (parsed: Record<string, unknown>) => T,
): Promise<{ value: T; ms: number }> {
  const name = tool.type === "function" ? tool.function.name : "";
  let ms = 0;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await chat(role, messages, { signal, maxTokens, tools: [tool], forceTool: name });
    ms += r.ms;
    const call = r.message.tool_calls?.find((t) => t.type === "function" && t.function.name === name);
    try {
      if (call && call.type === "function") return { value: validate(JSON.parse(call.function.arguments) as Record<string, unknown>), ms };
      // No tool call despite tool_choice (open models do this): retry once, then fall back to JSON in the text.
      if (attempt === 1) {
        lastError = "no tool call";
        messages.push({ role: "assistant", content: r.message.content || "" }, { role: "user", content: `Respond only via the ${name} tool. Call it now.` });
        continue;
      }
      return { value: validate(parseJsonReply(r.message.content) as Record<string, unknown>), ms };
    } catch (e) {
      lastError = (e as Error).message;
      if (attempt === 1) messages.push({ role: "user", content: `Your previous ${name} call was invalid: ${lastError}. Call ${name} again.` });
    }
  }
  throw new Error(`${name} invalid twice: ${lastError}`);
}

// ---------- Planner ----------
const rules = (r: string[]) => r.map((x) => `- ${x}`).join("\n");

async function plan(c: LiveCase, pb: Playbook, signal: AbortSignal): Promise<{ items: ChecklistItem[]; ms: number }> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are the Planner for a clinic back office. Turn a case goal into a done-checklist: 3 to 5 checks that a Verifier can decide as pass/fail purely from tool results and the chart.\n` +
        `Playbook v${pb.version}:\n${rules(pb.planner)}\n${ENV} ${SAFETY}\n` +
        `Call submit_checklist; each item has an id (c1, c2…), the check, and the evidence (which tool result or chart field proves it).`,
    },
    {
      role: "user",
      content:
        `Run goal: ${RUN_GOAL}\nCase ${c.id} (${c.agent}): ${c.goal}\nTools the worker will have: ${toolsFor(c.agent).map((t) => (t.type === "function" ? t.function.name : "")).join(", ")}\n` +
        `Case data (chart${c.era ? ", ERA" : ""}${c.criteria ? ", payer criteria" : ""}):\n${JSON.stringify({ chart: c.chart, era: c.era, payer_criteria: c.criteria })}`,
    },
  ];
  const { value: items, ms } = await structured("planner", messages, CHECKLIST_TOOL, 1200, signal, (parsed) => {
    const list = parsed.checklist;
    if (!Array.isArray(list) || list.length < 3 || list.length > 5) throw new Error("checklist must be an array of 3 to 5 items");
    return list.map((x, i) => {
      const o = x as Partial<ChecklistItem>;
      if (typeof o.check !== "string" || !o.check.trim()) throw new Error(`item ${i + 1} has no "check" string`);
      return { id: typeof o.id === "string" && o.id ? o.id : `c${i + 1}`, check: o.check.trim(), evidence: typeof o.evidence === "string" ? o.evidence : "" };
    });
  });
  return { items, ms };
}

// ---------- Verifier ----------
async function verify(c: LiveCase, items: ChecklistItem[], ctx: ToolCtx, log: { tool: string; args: unknown; result: unknown }[], signal: AbortSignal): Promise<{ verdicts: Verdict[]; ms: number }> {
  const evidence = JSON.stringify({ outbound_gate_current: ctx.outbox, tool_log: log });
  // Deterministic cross-reference, handed to the Verifier as evidence (it still makes the call): every NPI in the
  // outgoing submission, with the specialty earlier tool results claimed vs what the registry says.
  const outNpis = [...new Set((JSON.stringify(ctx.outbox).match(/\d{4}\b/g) || []).map((d) => "••" + d).filter((k) => REGISTRY[k]))];
  const crossCheck = outNpis.map((npi) => {
    const claimed = [...new Set(log.flatMap((l) => (l.tool === "check_npi" ? ((l.result as { matches?: { npi: string; specialty?: string }[] }).matches || []).filter((m) => m.npi === npi && m.specialty).map((m) => m.specialty!) : [])))];
    const reg = REGISTRY[npi];
    const conflict = claimed.some((sp) => sp.toLowerCase() !== reg.specialty.toLowerCase());
    return `${npi} in outgoing submission: registry says ${reg.name}, ${reg.specialty}${claimed.length ? `; lookup results claimed ${claimed.join("/")}` : ""}${conflict ? " — CONFLICT: the lookup label disagrees with the registry" : ""}`;
  });
  const chart = ctx.chartSeen || c.chart;
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are the Verifier. You did not do the work and you do not trust the worker's claims. Judge each checklist item ONLY against the chart, the tool log, what sits at the outbound gate, and the NPI registry (the registry is authoritative for provider identity and specialty). ` +
        `Pass an item only if the evidence clearly shows it. If something was never done, it fails. Judge the final state: outbound_gate_current holds exactly what will be released once you pass the case. ` +
        `"queued_for_release" is the expected state at verification time and counts as submitted/sent. Earlier submissions in the tool log were superseded and discarded; ignore them. If the final output is correct, an earlier wrong lookup or attempt does not fail an item. Judge provider identity by the registry record, not by the text of a search query. Judge each item by its own text only; never add requirements it doesn't state. ` +
        `Never fail an item because a field the environment doesn't have is missing. ${ENV} ${SAFETY}\n` +
        `Call submit_verdicts with exactly one verdict per checklist item, in order; each reason is one sentence citing the evidence.`,
    },
    {
      role: "user",
      content:
        `Case ${c.id}: ${c.goal}\nChecklist:\n${items.map((x, i) => `${i + 1}. ${x.check}`).join("\n")}\n\n` +
        `Chart (current):\n${JSON.stringify(chart)}\n\nNPI registry records (authoritative):\n${JSON.stringify(registryFor(evidence + JSON.stringify(chart)))}\n` +
        (crossCheck.length ? `Registry cross-check of the outgoing submission:\n${crossCheck.join("\n")}\n` : "") +
        `\nEvidence:\n${evidence}`,
    },
  ];
  try {
    const { value: verdicts, ms } = await structured("verifier", messages, VERDICT_TOOL, 2000, signal, (parsed) => {
      const v = parsed.verdicts;
      if (!Array.isArray(v) || v.length !== items.length) throw new Error(`need exactly ${items.length} verdicts`);
      return v.map((x, i) => {
        const o = x as Partial<Verdict>;
        if (typeof o.pass !== "boolean") throw new Error(`verdict ${i + 1}: "pass" must be true or false`);
        if (typeof o.reason !== "string" || !o.reason.trim()) throw new Error(`verdict ${i + 1}: "reason" is required`);
        return { check: typeof o.check === "string" && o.check ? o.check : items[i].check, pass: o.pass, reason: o.reason.trim() };
      });
    });
    return { verdicts, ms };
  } catch (e) {
    if (signal.aborted) throw e;
    // An unusable verdict never passes a case: it counts as a failed round.
    return { verdicts: items.map((x) => ({ check: x.check, pass: false, reason: `Verifier output unusable: ${(e as Error).message}` })), ms: 0 };
  }
}

// ---------- one case, end to end ----------
export async function runCase(c: LiveCase, emit: Emit, signal: AbortSignal, pb: Playbook = loadPlaybook()): Promise<"closed" | "escalated"> {
  const escalate = (reason: string, by: Extract<RunEvent, { type: "escalated" }>["by"]) => {
    emit({ type: "escalated", caseId: c.id, reason, by });
    return "escalated" as const;
  };
  try {
    emit({ type: "delegated", caseId: c.id, agent: c.agent });
    const { items, ms } = await plan(c, pb, signal);
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
          `You are the ${c.agent} worker agent at Sunrise Family Medicine. A Verifier checks your work against the done-checklist before anything leaves the clinic.\n` +
          `Playbook v${pb.version}:\n${rules(pb.worker)}\n${ENV} ${SAFETY}\n` +
          `When finished, reply with a one-sentence summary and no tool call.`,
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
        // Close gate, enforced in code: a case whose chart or payer criteria require a human never closes,
        // whatever the worker did or the Verifier said.
        const human = [c.chart, c.criteria].map((x) => x?.requires_human).find((x): x is string => typeof x === "string");
        if (human) return escalate(`Close blocked: ${human}`, "rule");
        emit({ type: "closed", caseId: c.id, summary: summary || "All checks passed.", value: c.value, released: ctx.outbox.map((o) => o.reference) });
        return "closed";
      }
      const failed = verdicts.filter((v) => !v.pass);
      if (ctx.round >= MAX_REPLANS) return escalate(`Still failing after ${MAX_REPLANS} re-plans: ${failed.map((f) => f.reason).join(" ")}`, "verifier");
      ctx.round++;
      seen.clear(); // a re-plan is a fresh attempt; the 12-step cap still spans the whole case
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
export async function runBacklog(cases: LiveCase[], emit: Emit, signal: AbortSignal, parallel = 4, models: Record<string, string> = {}, pb: Playbook = loadPlaybook()) {
  const t0 = Date.now();
  emit({ type: "run_start", goal: RUN_GOAL, cases: cases.map((c) => c.id), models, parallel, playbook: pb.version });
  const queue = [...cases];
  let closed = 0;
  let escalated = 0;
  await Promise.all(
    Array.from({ length: Math.min(parallel, cases.length) }, async () => {
      while (queue.length && !signal.aborted) {
        const c = queue.shift()!;
        const r = await runCase(c, emit, signal, pb).catch(() => null);
        if (r === "closed") closed++;
        else if (r === "escalated") escalated++;
      }
    }),
  );
  if (!signal.aborted) emit({ type: "run_end", closed, escalated, ms: Date.now() - t0 });
}
