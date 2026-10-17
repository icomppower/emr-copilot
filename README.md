# EMR Copilot

An agent team that clears a clinic's overnight back-office backlog (claim denials, prior auths, referrals, chart prep) and decides for itself when a case is done. Problem statement: **Done Means Done**. Synthetic data only, administrative work only, no medical advice.

## Built before / Built today

**Built before the event**
- Oct 13–14: scripted UI shell (agent graph, log, backlog, staff tray, morning report), originally a single `index.html`. It now lives as `app/markup.ts`, `app/globals.css` and `public/ui.js`.
- Oct 16 (evening): Next.js wrapper, the live agent loop (`lib/`), `/api/run` SSE streaming and the live-mode UI wiring. Runs against the Claude API as a stand-in until Crusoe credentials arrive.
- Oct 16, 23:20 – Oct 17, 01:30: config-only provider swap (model per role, per-model sampling params, rate-limit backoff, forced-tool-call fallback) and the Version N+1 self-improvement layer (Reviewer agent, versioned playbooks, fixed training/held-out split, scored runs in `/runs`, Playbook panel). All tuned on `claude-haiku-5-5`, not yet on Nemotron.

- Oct 17, 00:00–00:40 (before doors): first runs on **Crusoe + Nemotron** (Super 120B for Planner/Verifier, Nano 30B for Worker). Fixed what Nemotron exposed: a close gate in code for human-only cases, a deterministic NPI registry cross-check in the Verifier's evidence, and one request per case so no request has to fit the whole backlog. Full 20-case run on the preview: 16 closed, 4 to staff, DN-3308 fail → re-plan → pass.

**Built at the event (Oct 17, 13:30–17:00)**
- Case lanes raised from a hard cap of 8 to 20 (`CASE_CONCURRENCY`), `maxDuration` 800 s, and a log line for every rate-limit backoff, so 429s show in Vercel runtime logs.
- Merged `live-agent-loop` to `main`: production (emr-copilot.vercel.app) now runs the live loop on Nemotron via Crusoe instead of the scripted demo.
- Final unattended production run on Nemotron (numbers in `STATUS.md` and the pitch deck).
- 1-minute video.

## How the loop works

Each case runs Planner → Worker → Verifier → decide, 4 cases in parallel:

1. **Planner** writes a done-checklist of 3–5 machine-checkable items (JSON).
2. **Worker** acts through mock tools. Every tool call is validated against its JSON schema, and an invalid call gets one retry with the error.
3. **Verifier** is a separate call with its own model variable. It judges each checklist item against the chart, the tool log, the outbound gate and the NPI registry, and returns `{check, pass, reason}` per item.
4. **Decide.** All pass → `closed`, and held submissions are released. A failed check → `replan` (max 2), then escalate. The same tool and arguments 3×, or 12 steps → `loop_detected` → escalate. Anything clinical or needing a signature is escalated by a hard rule, not a model decision.

The SSE events are `delegated`, `checklist`, `tool_call`, `check_result`, `replan`, `loop_detected`, `escalated` and `closed` (plus `run_start`, `run_end` and `error`).

The mock tools are deterministic: `read_chart`, `read_era`, `check_npi`, `payer_criteria`, `submit_claim`, `submit_auth`, `fax_send`, `prepare_packet` and `escalate_to_staff`. They include these planted traps:
- **DN-3308:** a stale directory lookup labels a same-name dermatologist as cardiology, and only the Verifier's authoritative registry check catches it.
- **PA-1042:** the payer portal returns a 504 on the first submit.
- **RF-4412:** the referral fax line is always busy, which trips the loop detector.
- **DN-3311:** the clearinghouse rejects the first submit.
- **CP-2205:** pre-op labs are still pending on the first chart read.

## Version N+1 (self-improvement)

The Planner and Worker follow a versioned playbook (`playbooks/playbook_vN.md`). Safety rules, environment facts and the Verifier stay in code, so the Reviewer can't weaken them. `npm run evolve` runs one step:

1. Run the 12 training cases (`eval/split.json`) on the current playbook and score the run.
2. A **Reviewer** agent reads the run log (over-escalations, Verifier failures, re-plans, loops) and proposes **one** rule change, saved as the next `playbook_vN.md`.
3. Run training again with the candidate. It is kept only if the score improves; otherwise it is discarded.
4. Run the 8 held-out cases on the original v1 and on the kept playbook to get the before/after.

**Score** = correct closes + correct escalations − over-escalations − 2 × missed escalations − re-plans − loops.

The expected outcome for each case is in `lib/cases.ts`; escalating is correct only for signature, insurance, clinical and dead-fax cases. Closing a case that needed staff costs double. Every run's events and score are saved as JSON in `runs/`, and the latest step's summary is in `runs/evolution-latest.json`. Live runs use the kept version recorded in `playbooks/state.json`. Use `--repeats N` to average N runs per playbook, which matters because single runs are noisy.

## Run

```bash
cp .env.example .env.local   # add LLM_API_KEY
pnpm install
npm run dev                  # http://localhost:3000 → Run overnight
```

| Variable | Purpose |
|---|---|
| `LLM_BASE_URL` | OpenAI-compatible endpoint. Tonight `https://api.anthropic.com/v1`; event day `https://api.inference.crusoecloud.com/v1` |
| `LLM_API_KEY` | Server-side only (`.env.local` / Vercel env). Never sent to the browser |
| `LLM_MODEL_PLANNER`, `LLM_MODEL_WORKER`, `LLM_MODEL_VERIFIER` | Model per role; each falls back to `LLM_MODEL` |
| `DEMO_MODE` | `1` forces the scripted fallback |

With no key, or with `DEMO_MODE=1` or `?demo` in the URL, the console runs the original scripted demo and is labeled `DEMO_MODE · scripted`.
