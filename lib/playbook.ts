import fs from "node:fs";
import path from "node:path";

// Versioned Planner/Worker playbook: playbooks/playbook_vN.md, one rule per bullet.
// playbooks/state.json records which version is kept (used by live runs) and every keep/discard decision.

export type Section = "planner" | "worker";
export interface Playbook { version: number; planner: string[]; worker: string[] }
export interface Change { section: Section; action: "add" | "replace"; target?: string; rule: string; rationale: string }
export interface PlaybookState { current: number; history: { version: number; from: number; kept: boolean; at: string; change: Change; run: string }[] }

const DIR = path.join(process.cwd(), "playbooks");
const file = (v: number) => path.join(DIR, `playbook_v${v}.md`);

export function readState(): PlaybookState {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, "state.json"), "utf8"));
  } catch {
    return { current: 1, history: [] };
  }
}

export function writeState(s: PlaybookState) {
  fs.writeFileSync(path.join(DIR, "state.json"), JSON.stringify(s, null, 2) + "\n");
}

export function loadPlaybook(version = readState().current): Playbook {
  const text = fs.readFileSync(file(version), "utf8");
  const section = (name: string) => {
    const m = text.match(new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`));
    return (m ? m[1] : "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
  };
  return { version, planner: section("Planner"), worker: section("Worker") };
}

export function renderPlaybook(pb: Playbook, note = "") {
  return (
    `# Playbook v${pb.version}\n\n` +
    `Rules the Reviewer may change, one per version. Safety rules, environment facts and the Verifier live in code and are not part of the playbook.${note ? `\n\n${note}` : ""}\n\n` +
    `## Planner\n${pb.planner.map((r) => `- ${r}`).join("\n")}\n\n## Worker\n${pb.worker.map((r) => `- ${r}`).join("\n")}\n`
  );
}

export function nextVersion() {
  let v = 1;
  while (fs.existsSync(file(v + 1))) v++;
  return v + 1;
}

// Exactly one change: add a rule, or replace one existing rule (matched exactly, or by unique substring).
export function applyChange(pb: Playbook, ch: Change, version: number): Playbook {
  const rules = [...pb[ch.section]];
  const rule = ch.rule.trim().replace(/^-\s*/, "");
  if (ch.action === "replace") {
    const t = (ch.target || "").trim().replace(/^-\s*/, "");
    let i = rules.indexOf(t);
    if (i < 0) {
      const hits = rules.map((r, k) => (t && r.includes(t) ? k : -1)).filter((k) => k >= 0);
      if (hits.length !== 1) throw new Error(`replace target not found uniquely in ${ch.section}: "${t.slice(0, 80)}"`);
      i = hits[0];
    }
    rules[i] = rule;
  } else {
    rules.push(rule);
  }
  return { ...pb, version, [ch.section]: rules };
}

export function savePlaybook(pb: Playbook, from: number, ch: Change) {
  fs.writeFileSync(file(pb.version), renderPlaybook(pb, `Derived from v${from}: ${ch.action} in ${ch.section}. Reviewer's rationale: ${ch.rationale}`));
}

export function diffLines(a: Playbook, b: Playbook) {
  const out: { section: Section; op: "-" | "+"; rule: string }[] = [];
  for (const s of ["planner", "worker"] as Section[]) {
    for (const r of a[s]) if (!b[s].includes(r)) out.push({ section: s, op: "-", rule: r });
    for (const r of b[s]) if (!a[s].includes(r)) out.push({ section: s, op: "+", rule: r });
  }
  return out;
}
