# ADR-0003 — The terminal, the skill reader, clarify, and twelve weavr tools

**Status:** accepted · **Date:** 14 Sep 2026

## Context

Hermes' default tool set is the whole machine: file read/write/search,
Python `execute_code`, web search, memory, skill editing, browser. The weavr
MCP server exposes 30 tools, 18 of which build transactions for a wallet to
sign (`build_*`, `send_signed`, `await_portfolio`).

Three local models, given the full set, used it to wander instead of
following the skill: searching the disk for "wallet", reading the wallet
tool's source, calling `build_deposit` directly with the portfolio creator's
address as `user` (Qwen3-Coder-Next), writing helper scripts, storing
"user wants to deposit" in memory and acting on it a day later. The first
API call was ~22k tokens.

## Decision

`platform_toolsets` for cli and telegram is **`[terminal, skills, clarify]`**:
the terminal for the wallet proxy, the skill reader, one way to ask the user.
Hermes accepts toolset names only, so `skills` carries `skill_manage`; the
skills directory is **root-owned** at install, so `skill_manage` fails.
Bundled skills (88, `pay-sh` and `crypto` among them) are pruned to `weavr`;
the sync treats a missing skill as user-deleted and does not restore it.

The weavr server's `tools.include` is the eleven reads and simulations plus
`create_portfolio`. Every `build_*`, `send_signed` and `await_portfolio` is
out of the prompt: deposits, withdrawals and mix changes go through the
wallet tool (ADR-0002), which calls those same MCP tools itself, out of the
model's sight.

The memory file (`memories/MEMORY.md`) is empty and root-owned: nothing the
model decides today is injected into tomorrow's prompt.

## Consequences

- First call ~10k tokens (12.4 KB system prompt, 6 host tools + 12 MCP);
  the model lists exactly those 17 tools when asked.
- An agent that exists only for weavr needs nothing else. This is the
  *dedicated agent* layout (ours, and a user's own from this repository);
  the weavr skill itself makes no demand on other tools, so it can also be
  dropped into an agent that does other work.
- New wallet actions are added as wallet-tool modes, not as MCP tools in the
  prompt — `--withdraw` and `--propose` followed this rule the same day.
