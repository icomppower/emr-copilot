# Status: Fri Oct 16, 23:50 (branch `live-agent-loop`)

All work tonight ran on `claude-haiku-5-5` as a stand-in. Nothing is tuned on Nemotron yet.

## What works
- **Live agent loop, 20 cases, 4 in parallel:** Planner done-checklist → Worker tools → Verifier → close, re-plan (max 2), loop stop or escalation. No crashes in any run. DN-3308 (wrong-specialty NPI) goes fail → re-plan → pass reliably.
- **Provider swap is config-only:**
  - A model per role (`LLM_MODEL_PLANNER`, `_WORKER`, `_VERIFIER`, each falling back to `LLM_MODEL`).
  - A per-model params table: Nemotron gets temperature 1.0, top_p 0.95 and max_tokens ≥ 4000; Claude gets no temperature.
  - 429/5xx retried with exponential backoff that honors `retry-after` and rate-limit reset headers.
  - A forced tool call that returns no tool call is retried once, then parsed from the reply text, and always validated.
- **CP-2204** escalates as "Lab result flagged for physician review". Agents never assess it, in both live and scripted mode.
- **Version N+1** (`npm run evolve`): a Reviewer proposes one playbook rule from the training run log; the rule is kept only if the training score improves; held-out v1 is compared with the kept version. Every run is saved in `runs/`, and the Playbook panel in the dock shows the version, the diff and the scores.

## Latest scores (3 repeats per playbook)
Score = correct closes + correct escalations − over-escalations − 2·missed escalations − re-plans − loops. Training has 12 cases, held-out 8.

| Step | Reviewer's change | Training | Decision | Held-out v1 → kept |
|---|---|---|---|---|
| 1 | Planner: don't require timestamps or "submitted today" checks unless the goal asks | v1 5.67 → v2 7.00 | **kept v2** | 2.00 → 2.33 |
| 2 | Worker: on a busy or transient send failure, try another channel instead of repeating | v2 9.67 → v3 8.00 | **discarded** | 4.67 → 5.33 |

**Held-out pooled over both steps:** v1 3.33 vs v2 3.83 (6 runs each). That's a small gain, well inside run-to-run noise: the same playbook scores from 1 to 7 on the same 8 cases. The mechanism works (keep and discard both happen), but tonight's numbers don't prove v2 is better. Expect the same noise on Nemotron; use `--repeats 3` or more.

## What doesn't (yet)
- **Haiku still over-escalates about 1 case in 12, at random:** the worker escalates work it could finish, or the Verifier fails a correct output on wording. That's the main source of the noise above.
- **The first experiment found a CP-2205 data bug:** the chart changed between Planner and Verifier. It's fixed, and those runs are archived in `runs/pre-fix/`.
- **No Nemotron runs at all:** tool-call reliability and the over-escalation rate on Nemotron are unknown.
- **The Vercel preview is not set up yet.** It's in progress after this file.

## Commands
```bash
pnpm install
npm run dev                       # http://localhost:3000 → Run overnight (live if .env.local has a key)
npm run evolve -- --repeats 3     # one Version N+1 step (~5 min on Haiku)
open "http://localhost:3000/?demo"  # scripted fallback
```

## Switching to Crusoe + Nemotron tomorrow (`.env.local`)
```bash
LLM_BASE_URL=https://api.inference.crusoecloud.com/v1
LLM_API_KEY=<Crusoe key>
LLM_MODEL_PLANNER=nvidia/Nemotron-3-Super-120B-A12B
LLM_MODEL_WORKER=nvidia/Nemotron-3-Nano-30B-A3B
LLM_MODEL_VERIFIER=nvidia/Nemotron-3-Ultra-550B   # fall back to Super if the key lacks Ultra
# Remove or replace LLM_MODEL=claude-haiku-5-5 (the per-role vars take precedence anyway)
```
Check the exact IDs with `curl -s $LLM_BASE_URL/models -H "Authorization: Bearer $LLM_API_KEY"`. The Nemotron sampling params apply automatically (matched on "nemotron" in the model ID).

On the trial tier (30 requests/min per model) the backoff will absorb 429s, but a 20-case run will be slow. Consider `?parallel=2` on `/api/run`.
