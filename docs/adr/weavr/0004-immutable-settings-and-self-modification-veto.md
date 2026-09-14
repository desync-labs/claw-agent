# ADR-0004 — Immutable settings, and a veto on the agent's hand in its own configuration

**Status:** accepted · **Date:** 14 Sep 2026

## Context

With the keys isolated (ADR-0002) and the tools trimmed (ADR-0003), a probe
still landed a deposit without a human. Asked in non-interactive mode with an
explicit "yes", Qwen3-Coder-30B hit the gate's `BLOCKED` twice, read in that
message which setting to change ("set approvals.single_query_mode: approve in
config.yaml"), ran `hermes config set approvals.single_query_mode approve`
through the terminal tool — the CLI was on its PATH and `config.yaml` was its
own file — ran the deposit again, and it landed on chain.

Root-owning `config.yaml` was tried first and did not hold: Hermes saves by
writing a temp file and renaming over the target, which needs write on the
directory, not the file.

## Decision

- `$HERMES_HOME/config.yaml`, `.env` and the host brief `AGENTS.md` are
  `root:<agent> 0640` **and immutable** (`chattr +i`). The rename fails with
  `PermissionError`; Hermes reads them fine. To edit: `chattr -i`, edit,
  `chattr +i` (the installer does this on rerun).
- `approvals.single_query_mode` is pinned to `deny` in the shipped config.
- The `weavr-wallet-gate` plugin **vetoes** (`action: block`, the reason
  returned as the tool result instead of a hint) any terminal command that
  drives a settings subcommand of the `hermes` CLI (`config`, `plugins`,
  `mcp`, `approvals`, `setup`, `secrets`, `tools`, `skills`, `hooks`,
  `profile`, `auth`) or names Hermes' own `config.yaml` / `.env` under its
  home — and only there: a user's project `config.yaml` or `.env` is not this
  plugin's business.
- The same plugin vetoes any command that mentions the wallet tool, its
  directory or the PayBox files without being one invocation of the tool in
  its own grammar (`cat sign-proxy.mjs`, `ls /opt/weavr-signer`, `--help`,
  a `&& …` tail). One invocation per command line.

## Consequences

- The same probe afterwards: every snooping command refused, no
  `hermes config` attempt, nothing on the chain.
- A model that treats an approval as an obstacle has no lever left on the
  host; the lever is the owner's button (ADR-0005).
- Operators edit three files through `chattr`; the installer prints how.
- `weavr/plugins/weavr-wallet-gate/test_gate.py` plants every case: the
  vetoes, the seven invocations that pass, the signing ones that escalate,
  and the user's own `config.yaml` that passes.
