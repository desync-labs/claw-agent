# ADR-0006 — A host brief in the agent's cwd, in every system prompt

**Status:** accepted · **Date:** 14 Sep 2026

## Context

The weavr skill (`SKILL.md`, served by the API and installed under
`$HERMES_HOME/skills/weavr`) is the procedure. Hermes shows the model only
the skill's one-line description; the body arrives when the model calls
`skill_view`. Claude does that. Three local models mostly did not: after
`CREATOR_REQUIRED` from `create_portfolio`, Qwen3-Coder-30B ran `which
wallet`, `find … paybox`, found nothing, concluded there was no wallet tool
and reserved a **sign link** instead — the fallback for hosts without a
wallet, useless with PayBox. Earlier the same model had improvised a
deployment id from a mint and a deposit into an asset ticker.

Hermes loads `AGENTS.md` from the agent's working directory into the
"context" tier of every system prompt.

## Decision

`weavr/AGENTS.md` is installed as `/home/<agent>/AGENTS.md`, root-owned and
immutable, and the gateway runs from that directory. It is 2.7 KB and says
what the skill says, in the order a model acts: this host **has** the wallet
tool and it is `$WEAVR_SIGN_TOOL`, never `wallet: "link"`, the address comes
from `--address` only; the short form of address / create / deposit /
withdraw / rebalance; one command per terminal call; ask once, run once, on
`BLOCKED` stop; how to read the tool's errors; shares are whole units.

The skill remains the source of truth for every host; the brief is this
host's restatement and must not contradict it. Both are updated together.

## Consequences

- With the brief, the same model created CLAWA1 first time (`--address` →
  simulate → create → `--deployment` → live) and rebalanced it first time
  (one button, propose + apply in one run). Without it, neither.
- +2.7 KB per prompt; the memory file is emptied to pay for it (ADR-0003).
- Two texts to keep in sync; the ops runbook lists the pair.
