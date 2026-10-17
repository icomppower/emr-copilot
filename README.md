# EMR Copilot

An agent team that clears a clinic's overnight back-office backlog (claim denials, prior auths, referrals, chart prep) and decides for itself when a case is done. Problem statement: **Done Means Done**. Synthetic data only, administrative work only, no medical advice.

## Built before / Built today

**Built before the event**
- Oct 13–14: scripted UI shell (agent graph, log, backlog, staff tray, morning report), originally a single `index.html`. It now lives as `app/markup.ts`, `app/globals.css` and `public/ui.js`.
- Oct 16: Next.js wrapper, the live agent loop (`lib/`), `/api/run` SSE streaming and the live-mode UI wiring. Runs against the Claude API as a stand-in until Crusoe credentials arrive.

**Built at the event (Oct 17)**
- _Fill in on the day._

## How the loop works

Each case runs Planner → Worker → Verifier → decide, 4 cases in parallel:

1. **Planner** writes a done-checklist of 3–5 machine-checkable items (JSON).
2. **Worker** acts through mock tools. Every tool call is validated against its JSON schema, and an invalid call gets one retry with the error.
3. **Verifier** is a separate call with its own model variable. It judges each checklist item against the chart, the tool log, the outbound gate and the NPI registry, and returns `{check, pass, reason}` per item.
4. **Decide.** All pass → `closed`, and held submissions are released. A failed check → `replan` (max 2), then escalate. The same tool and arguments 3×, or 12 steps → `loop_detected` → escalate. Anything clinical or needing a signature is escalated by a hard rule, not a model decision.

The SSE events are `delegated`, `checklist`, `tool_call`, `check_result`, `replan`, `loop_detected`, `escalated` and `closed` (plus `run_start`, `run_end` and `error`).

The mock tools are deterministic: `read_chart`, `read_era`, `check_npi`, `payer_criteria`, `submit_claim`, `submit_auth`, `fax_send`, `prepare_packet` and `escalate_to_staff`. They include these planted traps:
- **DN-3308:** the NPI search returns a same-name dermatologist for a cardiology referral, and only the Verifier's registry check catches it.
- **PA-1042:** the payer portal returns a 504 on the first submit.
- **RF-4412:** the referral fax line is always busy, which trips the loop detector.
- **DN-3311:** the clearinghouse rejects the first submit.
- **CP-2205:** pre-op labs are still pending on the first chart read.

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
| `LLM_MODEL` | Planner and workers |
| `LLM_MODEL_VERIFIER` | Verifier (defaults to `LLM_MODEL`) |
| `DEMO_MODE` | `1` forces the scripted fallback |

With no key, or with `DEMO_MODE=1` or `?demo` in the URL, the console runs the original scripted demo and is labeled `DEMO_MODE · scripted`.
