# ADR-0001 — A ClawPump-derived fork, pinned at one commit, with one patch

**Status:** accepted · **Date:** 6 Sep 2026 (pin), 14 Sep 2026 (fork)

## Context

The weavr agent is built on [Clawpump/claw-agent](https://github.com/Clawpump/claw-agent)
(ClawPump's edition of Nous Research's Hermes Agent), not on upstream Hermes:
a product decision that keeps the ClawPump lineage explicit.

The ClawPump repository is young (June 2026), small (nine stars when we
forked), and not a GitHub fork of Hermes — it was copied, so GitHub shows no
diff against upstream. It ships 88 bundled skills, a `clawpump` MCP server
seeded into every config, and a `main` branch that moves. An agent that holds
a signing key cannot track a moving branch of a repository nobody reviews.

One line in the fork's MCP trust gate is wrong for weavr: a tool without a
`readOnlyHint` annotation is treated as write-capable even when the server
marks it read-only, so every read (`get_portfolio`, `list_assets`) would ask
for approval. weavr's colleague fixed it in a one-line patch
(`weavr/patches/trust-gate-read-only-hint.patch`, fork PR #33, open).

## Decision

- The agent runs from **this repository**: a fork of `Clawpump/claw-agent`,
  branch `weavr`, based on commit **`7b81ee9`** (the fork's `main` on
  6 Sep 2026, the commit the rehearsals were run on).
- The trust-gate patch is **applied in the fork** (`tools/mcp_tool.py`), with
  its test (`weavr/patches/test_trust_gate.py`) in CI, so a deployment never
  depends on applying a patch by hand.
- Everything weavr adds lives under **`weavr/`** and `docs/adr/weavr/`;
  upstream files are not edited beyond that one patch and a README banner, so
  rebasing on a newer ClawPump commit is one `git rebase` and one test run.
- The fork's `clawpump` MCP server stays **disabled** in the shipped config;
  the 88 bundled skills are pruned to `weavr` at install (ADR-0003).

## Consequences

- Upstream fixes arrive only when we choose to move the pin; the price of
  auditability. `docs/UPSTREAM_SYNC.md` (upstream's own) describes the rebase.
- The lineage is literal: the agent *is* ClawPump's code.
- If ClawPump merges PR #33 the patch becomes a no-op on rebase; until then
  the test guards it.
