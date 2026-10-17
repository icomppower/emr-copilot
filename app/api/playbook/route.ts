import fs from "node:fs";
import path from "node:path";
import { loadPlaybook, readState } from "@/lib/playbook";

export const dynamic = "force-dynamic";

// Playbook panel data: current version, its rules, and the latest Version N+1 result.
export async function GET() {
  const state = readState();
  let latest = null;
  try {
    latest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "runs", "evolution-latest.json"), "utf8"));
  } catch {}
  let runs = 0;
  try {
    runs = fs.readdirSync(path.join(process.cwd(), "runs")).filter((f) => f.endsWith(".json") && f !== "evolution-latest.json").length;
  } catch {}
  return Response.json({ current: state.current, playbook: loadPlaybook(state.current), history: state.history, latest, runs });
}
