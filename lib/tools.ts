import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { REGISTRY, type Agent, type LiveCase } from "./cases";

// Deterministic mock tools. Small schemas on purpose: open models are weaker at tool calling,
// so every call is validated here before anything runs.

type Schema = {
  type: "object";
  properties: Record<string, { type: "string" | "array"; enum?: string[]; items?: { type: "string" }; description?: string }>;
  required: string[];
  additionalProperties: false;
};

const S = (props: Schema["properties"], required: string[]): Schema => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (description: string) => ({ type: "string" as const, description });
const list = (description: string) => ({ type: "array" as const, items: { type: "string" as const }, description });

const DEFS: Record<string, { description: string; parameters: Schema }> = {
  read_chart: { description: "Read the administrative chart for this case: payer, orders, documents, history on file.", parameters: S({ case_id: str("Case ID, e.g. DN-3308") }, ["case_id"]) },
  read_era: { description: "Read the remittance (ERA) for a denied claim: CARC code, description, amount.", parameters: S({ claim_id: str("Claim ID, e.g. CL-3308") }, ["claim_id"]) },
  check_npi: { description: "Search the NPI registry for a provider by name and specialty.", parameters: S({ name: str("Provider or practice name"), specialty: str("Specialty, e.g. Cardiology") }, ["name", "specialty"]) },
  payer_criteria: { description: "Get a payer's documented criteria for an item (drug, imaging, device, appeal).", parameters: S({ payer: str("Payer name"), item: str("Item, e.g. Ozempic") }, ["payer", "item"]) },
  submit_claim: {
    description: "Queue a corrected claim or an appeal. Held at the outbound gate until the Verifier passes the case.",
    parameters: S({ claim_id: str("Claim ID"), action: { type: "string", enum: ["resubmit", "appeal"] }, changes: list("Each change as field=value or a short sentence"), attachments: list("Documents attached (appeals)") }, ["claim_id", "action", "changes"]),
  },
  submit_auth: {
    description: "Submit a prior authorization request through the payer portal. Held at the outbound gate until the Verifier passes the case.",
    parameters: S({ case_id: str("Case ID"), payer: str("Payer name"), item: str("Drug, device or service exactly as requested"), dose: str("Dose and frequency, if a drug"), evidence: list("Evidence from the chart that meets each criterion") }, ["case_id", "payer", "item", "evidence"]),
  },
  fax_send: { description: "Fax a referral packet to a provider by NPI. Queued at the outbound gate until the Verifier passes the case.", parameters: S({ to_npi: str("Recipient NPI"), documents: list("Documents in the packet") }, ["to_npi", "documents"]) },
  prepare_packet: { description: "Save the pre-visit packet for the appointment.", parameters: S({ case_id: str("Case ID"), items: list("Packet items: documents, flags from registries, pending items") }, ["case_id", "items"]) },
  escalate_to_staff: { description: "Hand the case to clinic staff. Use for anything clinical, anything needing a signature, or anything agents cannot finish.", parameters: S({ reason: str("One sentence: what staff must do and why") }, ["reason"]) },
};

const BY_AGENT: Record<Agent, string[]> = {
  ChartPrep: ["read_chart", "prepare_packet", "escalate_to_staff"],
  PriorAuth: ["read_chart", "payer_criteria", "submit_auth", "escalate_to_staff"],
  Referral: ["read_chart", "check_npi", "fax_send", "escalate_to_staff"],
  Denials: ["read_chart", "read_era", "check_npi", "payer_criteria", "submit_claim", "escalate_to_staff"],
};

export function toolsFor(agent: Agent): ChatCompletionTool[] {
  return BY_AGENT[agent].map((name) => ({ type: "function", function: { name, description: DEFS[name].description, parameters: DEFS[name].parameters } }));
}

export function validateArgs(agent: Agent, name: string, raw: string): { args: Record<string, unknown> } | { error: string } {
  if (!BY_AGENT[agent].includes(name) || !DEFS[name]) return { error: `Unknown tool "${name}". Available: ${BY_AGENT[agent].join(", ")}.` };
  let args: unknown;
  try {
    args = JSON.parse(raw || "{}");
  } catch (e) {
    return { error: `Arguments are not valid JSON (${(e as Error).message}).` };
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return { error: "Arguments must be a JSON object." };
  const schema = DEFS[name].parameters;
  const obj = args as Record<string, unknown>;
  for (const k of schema.required) if (obj[k] === undefined) return { error: `Missing required field "${k}".` };
  for (const [k, v] of Object.entries(obj)) {
    const p = schema.properties[k];
    if (!p) return { error: `Unexpected field "${k}". Allowed: ${Object.keys(schema.properties).join(", ")}.` };
    if (p.type === "string") {
      if (typeof v !== "string" || !v.trim()) return { error: `"${k}" must be a non-empty string.` };
      if (p.enum && !p.enum.includes(v)) return { error: `"${k}" must be one of ${p.enum.join(", ")}.` };
    } else if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      return { error: `"${k}" must be an array of strings.` };
    } else if (schema.required.includes(k) && v.length === 0) {
      return { error: `"${k}" must not be empty.` };
    }
  }
  return { args: obj };
}

export interface ToolCtx {
  c: LiveCase;
  round: number; // Verifier rounds failed so far
  calls: Record<string, number>; // per-tool call counts, for mocks that change on retry
  chartSeen: Record<string, unknown> | null; // last chart version returned
  outbox: { tool: string; args: Record<string, unknown>; reference: string }[];
}

export type ToolResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

const held = (ctx: ToolCtx, tool: string, args: Record<string, unknown>, prefix: string): ToolResult => {
  const reference = `${prefix}-${ctx.c.id.replace(/\D/g, "")}${ctx.outbox.length ? "-" + (ctx.outbox.length + 1) : ""}`;
  ctx.outbox.push({ tool, args, reference });
  return { ok: true, data: { status: "queued_for_release", reference, note: "Held at the outbound gate until the Verifier passes this case." } };
};

export function runTool(ctx: ToolCtx, name: string, args: Record<string, unknown>): ToolResult {
  const { c } = ctx;
  const n = (ctx.calls[name] = (ctx.calls[name] || 0) + 1);
  switch (name) {
    case "read_chart": {
      const chart = n > 1 && c.chartRecheck ? c.chartRecheck : c.chart;
      ctx.chartSeen = chart;
      return { ok: true, data: { case_id: c.id, ...chart } };
    }
    case "read_era":
      return c.era ? { ok: true, data: c.era } : { ok: false, error: `No ERA on file for ${String(args.claim_id)}.` };
    case "check_npi": {
      if (c.traps?.npiNameOnly && ctx.round === 0) {
        // Planted trap: name-only hit, specialty not returned. Only the Verifier's registry check can catch it.
        return { ok: true, data: { query: args, matches: [{ npi: c.traps.npiNameOnly, name: "K. Lee, MD", city: "San Francisco" }], note: "Name search, 1 match." } };
      }
      const pool = (c.providers || Object.keys(REGISTRY)).map((k) => REGISTRY[k]);
      const spec = String(args.specialty).toLowerCase();
      const hits = pool.filter((p) => p.specialty.toLowerCase().includes(spec) || spec.includes(p.specialty.toLowerCase()));
      return { ok: true, data: { query: args, matches: hits.length ? hits : pool } };
    }
    case "payer_criteria":
      return { ok: true, data: c.criteria || { payer: args.payer, item: args.item, requires: [], note: "No special criteria on file." } };
    case "submit_claim":
    case "submit_auth": {
      const trap = c.traps?.submitFailsOnce;
      if (trap && trap.tool === name && n === 1) return { ok: false, error: trap.error };
      return held(ctx, name, args, name === "submit_auth" ? "AUTH" : "CLM");
    }
    case "fax_send": {
      const npi = normalizeNpi(String(args.to_npi));
      if (!REGISTRY[npi]) return { ok: false, error: `NPI ${npi} not found in the registry.` };
      if (c.traps?.faxBusy) return { ok: false, error: `Line busy at ${REGISTRY[npi].name}. Fax not sent.` };
      return held(ctx, name, args, "FAX");
    }
    case "prepare_packet":
      ctx.outbox.push({ tool: name, args, reference: `PKT-${c.id}` });
      return { ok: true, data: { status: "saved", items: (args.items as string[]).length } };
    default:
      return { ok: false, error: `Unknown tool ${name}.` };
  }
}

const normalizeNpi = (s: string) => {
  const d = s.match(/(\d{4})\s*$/);
  return d ? "••" + d[1] : s;
};

// Registry records for every NPI mentioned anywhere in the evidence: the Verifier's independent source.
export function registryFor(text: string) {
  const npis = [...new Set((text.match(/\d{4}\b/g) || []).map((d) => "••" + d))];
  return Object.fromEntries(npis.filter((k) => REGISTRY[k]).map((k) => [k, REGISTRY[k]]));
}
