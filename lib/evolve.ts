import fs from "node:fs";
import path from "node:path";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { runBacklog, structured, type RunEvent, type Verdict } from "./agent";
import { LIVE_CASES } from "./cases";
import { llmConfig } from "./llm";
import { applyChange, diffLines, loadPlaybook, nextVersion, readState, renderPlaybook, savePlaybook, writeState, type Change, type Playbook } from "./playbook";

// "Version N+1": score a training run, let a Reviewer propose ONE playbook change, re-run training with it,
// keep it only if the score improves, then compare original vs kept on held-out cases. Every run is saved to /runs.

const RUNS = path.join(process.cwd(), "runs");
export const SPLIT = JSON.parse(fs.readFileSync(path.join(process.cwd(), "eval", "split.json"), "utf8")) as { training: string[]; heldout: string[] };

// Score = correct closes + correct escalations − over-escalations − 2 × missed escalations − re-plans − loops.
// A missed escalation (closing a case that needed staff) costs double: it is the unsafe failure.
export const SCORE_FORMULA = "closed_correct + escalated_correct − over_escalated − 2·missed_escalation − replans − loops";

export interface CaseResult { id: string; expected: "closed" | "escalated"; actual: "closed" | "escalated" | "none"; replans: number; loops: number; reason?: string; failed: string[] }
export interface Score { score: number; closed_correct: number; escalated_correct: number; over_escalated: number; missed_escalation: number; replans: number; loops: number; cases: number }
export interface RunRecord { file: string; label: string; playbook: number; cases: string[]; score: Score; results: CaseResult[] }

export function scoreEvents(caseIds: string[], events: RunEvent[]): { score: Score; results: CaseResult[] } {
  const results: CaseResult[] = caseIds.map((id) => {
    const c = LIVE_CASES.find((x) => x.id === id)!;
    const mine = events.filter((e) => "caseId" in e && e.caseId === id);
    const closed = mine.some((e) => e.type === "closed");
    const esc = mine.find((e) => e.type === "escalated") as Extract<RunEvent, { type: "escalated" }> | undefined;
    const failed = mine.flatMap((e) => (e.type === "check_result" && !e.pass ? e.verdicts.filter((v: Verdict) => !v.pass).map((v) => v.reason) : []));
    return {
      id,
      expected: c.expect === "escalate" ? "escalated" : "closed",
      actual: closed ? "closed" : esc ? "escalated" : "none",
      replans: mine.filter((e) => e.type === "replan").length,
      loops: mine.filter((e) => e.type === "loop_detected").length,
      reason: esc?.reason,
      failed,
    };
  });
  const n = (f: (r: CaseResult) => boolean) => results.filter(f).length;
  const s = {
    closed_correct: n((r) => r.expected === "closed" && r.actual === "closed"),
    escalated_correct: n((r) => r.expected === "escalated" && r.actual === "escalated"),
    over_escalated: n((r) => r.expected === "closed" && r.actual !== "closed"),
    missed_escalation: n((r) => r.expected === "escalated" && r.actual === "closed"),
    replans: results.reduce((a, r) => a + r.replans, 0),
    loops: results.reduce((a, r) => a + r.loops, 0),
    cases: results.length,
  };
  return { score: { score: s.closed_correct + s.escalated_correct - s.over_escalated - 2 * s.missed_escalation - s.replans - s.loops, ...s }, results };
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export async function runSet(label: string, caseIds: string[], pb: Playbook, opts: { parallel?: number; signal?: AbortSignal; log?: (s: string) => void } = {}): Promise<RunRecord> {
  const events: RunEvent[] = [];
  const cases = LIVE_CASES.filter((c) => caseIds.includes(c.id));
  const t0 = Date.now();
  await runBacklog(cases, (e) => events.push(e), opts.signal || new AbortController().signal, opts.parallel ?? 6, llmConfig().models, pb);
  const { score, results } = scoreEvents(caseIds, events);
  fs.mkdirSync(RUNS, { recursive: true });
  const file = `runs/${stamp()}-${label}-v${pb.version}.json`;
  fs.writeFileSync(path.join(process.cwd(), file), JSON.stringify({ label, playbook: pb.version, models: llmConfig().models, formula: SCORE_FORMULA, ms: Date.now() - t0, cases: caseIds, score, results, events }, null, 1));
  opts.log?.(`${label} v${pb.version}: score ${score.score} (${score.closed_correct} closed ✓, ${score.escalated_correct} esc ✓, ${score.over_escalated} over-esc, ${score.missed_escalation} missed, ${score.replans} replans, ${score.loops} loops) → ${file}`);
  return { file, label, playbook: pb.version, cases: caseIds, score, results };
}

// ---------- Reviewer ----------
const CHANGE_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "propose_change",
    description: "Propose exactly one change to the playbook.",
    parameters: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["planner", "worker"] },
        action: { type: "string", enum: ["add", "replace"] },
        target: { type: "string", description: "For replace: the existing rule text, copied exactly" },
        rule: { type: "string", description: "The new rule: one sentence, general, no case IDs" },
        rationale: { type: "string", description: "Which failures in the run log this fixes and why" },
      },
      required: ["section", "action", "rule", "rationale"],
    },
  },
};

export async function review(run: RunRecord, pb: Playbook, signal: AbortSignal): Promise<Change> {
  const problems = run.results
    .filter((r) => r.actual !== r.expected || r.replans || r.loops)
    .map((r) => ({ case: r.id, expected: r.expected, actual: r.actual, replans: r.replans, loops: r.loops, escalation_reason: r.reason, verifier_failures: r.failed.slice(0, 4) }));
  const messages = [
    {
      role: "system" as const,
      content:
        `You are the Reviewer for a clinic back-office agent team (Planner writes a done-checklist, Worker acts with tools, Verifier checks). ` +
        `Read the run log and propose exactly ONE change to the Planner/Worker playbook: add one rule or replace one existing rule. ` +
        `Aim at the failures that cost the most score (${SCORE_FORMULA}). The rule must be general (no case IDs, patient names or claim numbers) so it helps unseen cases. ` +
        `Never weaken safety: clinical content and signatures always go to staff, and that is enforced in code anyway. Don't restate an existing rule. ` +
        `Call propose_change.`,
    },
    {
      role: "user" as const,
      content: `Current playbook:\n${renderPlaybook(pb)}\n\nTraining run score: ${JSON.stringify(run.score)}\n\nCases with problems:\n${JSON.stringify(problems, null, 1)}`,
    },
  ];
  const { value } = await structured("reviewer", messages, CHANGE_TOOL, 1500, signal, (p) => {
    const ch = p as unknown as Change;
    if (ch.section !== "planner" && ch.section !== "worker") throw new Error('section must be "planner" or "worker"');
    if (ch.action !== "add" && ch.action !== "replace") throw new Error('action must be "add" or "replace"');
    if (typeof ch.rule !== "string" || ch.rule.trim().length < 10) throw new Error("rule must be a sentence");
    if (/\b[A-Z]{2}-\d{4}\b|CL-\d{4}/.test(ch.rule)) throw new Error("rule must not mention case or claim IDs");
    if (typeof ch.rationale !== "string") throw new Error("rationale is required");
    applyChange(pb, ch, pb.version + 1); // throws if a replace target doesn't match
    return ch;
  });
  return value;
}

// ---------- one Version N+1 step ----------
export async function evolve(opts: { repeats?: number; log?: (s: string) => void; signal?: AbortSignal } = {}) {
  const log = opts.log || (() => {});
  const signal = opts.signal || new AbortController().signal;
  const repeats = Math.max(1, opts.repeats ?? 1);
  const avg = (runs: RunRecord[]) => Math.round((runs.reduce((a, r) => a + r.score.score, 0) / runs.length) * 100) / 100;
  const runN = async (label: string, ids: string[], pb: Playbook) => {
    const out: RunRecord[] = [];
    for (let i = 0; i < repeats; i++) out.push(await runSet(`${label}${repeats > 1 ? `-r${i + 1}` : ""}`, ids, pb, { signal, log }));
    return out;
  };

  const original = loadPlaybook();
  log(`Playbook v${original.version}: training baseline on ${SPLIT.training.length} cases × ${repeats}`);
  const base = await runN("train-baseline", SPLIT.training, original);

  const change = await review(base[base.length - 1], original, signal);
  const candidate = applyChange(original, change, nextVersion());
  savePlaybook(candidate, original.version, change);
  log(`Reviewer → v${candidate.version}: ${change.action} (${change.section}) "${change.rule}"`);

  const cand = await runN("train-candidate", SPLIT.training, candidate);
  const baseScore = avg(base);
  const candScore = avg(cand);
  const kept = candScore > baseScore;
  const keptPb = kept ? candidate : original;
  log(`Training: v${original.version} ${baseScore} → v${candidate.version} ${candScore} → ${kept ? "KEEP" : "DISCARD"}`);

  // Held-out always compares the root playbook (v1) with whatever is kept now, so repeated steps stay comparable.
  const root = loadPlaybook(1);
  const heldBefore = await runN("heldout-original", SPLIT.heldout, root);
  const heldAfter = keptPb.version !== root.version ? await runN("heldout-kept", SPLIT.heldout, keptPb) : heldBefore;
  log(`Held-out: v${root.version} ${avg(heldBefore)} → v${keptPb.version} ${avg(heldAfter)}`);

  const state = readState();
  state.current = keptPb.version;
  state.history.push({ version: candidate.version, from: original.version, kept, at: new Date().toISOString(), change, run: "" });
  const record = {
    at: new Date().toISOString(),
    models: llmConfig().models,
    formula: SCORE_FORMULA,
    split: SPLIT,
    repeats,
    original: original.version,
    heldout_baseline: 1,
    candidate: candidate.version,
    kept,
    current: keptPb.version,
    change,
    diff: diffLines(original, candidate),
    training: { baseline: baseScore, candidate: candScore, runs: [...base, ...cand].map((r) => ({ file: r.file, playbook: r.playbook, score: r.score })) },
    heldout: { before: avg(heldBefore), after: avg(heldAfter), runs: [...new Set([...heldBefore, ...heldAfter])].map((r) => ({ file: r.file, playbook: r.playbook, score: r.score })) },
  };
  const file = `runs/${stamp()}-evolution.json`;
  state.history[state.history.length - 1].run = file;
  writeState(state);
  fs.writeFileSync(path.join(process.cwd(), file), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(RUNS, "evolution-latest.json"), JSON.stringify({ ...record, file }, null, 2));
  return { ...record, file };
}
