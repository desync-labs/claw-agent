# ADR-0007 — Claude by default; a local model is possible, with the brief and a large window

**Status:** accepted · **Date:** 14 Sep 2026

## Context

weavr's rehearsals of 6–7 Sep 2026 ran on `claude-sonnet-5`: thesis to live
portfolio in 35–87 s, ~8 API calls per create, the skill followed first
time. On 14 Sep the same agent was run on three local models behind an
OpenAI-compatible server (llama.cpp via Lemonade, one node), to see whether
the agent can run without a hosted model:

| model | assets question | deposit without a human | notes |
|---|---|---|---|
| gpt-oss-120b (MXFP4) | correct, 71 s | 3.5 min of wandering, read the PayBox config and decoded the key | 15k-token first call, 98 s cold |
| Qwen3-Coder-Next (MXFP4) | wrong (one ticker), 94 s | called `build_deposit` with the creator's address | 22k-token first call |
| Qwen3-Coder-30B-A3B (Q4_K_M) | correct, 59 s | reached the right command, gate BLOCKED, 131 s | 10k-token first call with ADR-0003; ~10 s per call warm |

With ADR-0002…0006 in place, the 30B model ran the whole day's flows over
Telegram (create, deposit, two mix changes, withdrawal) with one wrong
command shape caught by the gate's refusal text.

## Decision

- The shipped `config.yaml` defaults to **`anthropic/claude-sonnet-5`**:
  it is the model the procedure was designed and proven on, and the one
  that reads the skill unprompted.
- A **local model is supported** as a documented alternative
  (`provider: custom`, `base_url`, `context_length`), on these terms: a
  window of at least 128k (the first call is ~10k and a conversation with
  tool results reaches 30–50k), `tool_search` off, the host brief installed,
  and the operator having run the -q proofs on that model first.
- Auxiliary tasks (titles, compression) are routed to the same endpoint when
  local, never to a third-party provider by default.

## Consequences

- Cost and privacy can be traded for reliability per deployment; the controls
  of ADR-0002…0005 are what make the trade safe, not the model.
- `hermes prompt-size --platform telegram` is the check after any change to
  tools or skills: the numbers above are its output.
