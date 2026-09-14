# ADR-0005 — One human button per signature, in Telegram

**Status:** accepted · **Date:** 6 Sep 2026 (gate), 14 Sep 2026 (seven actions)

## Context

PayBox's own MCP completes a signature only inside its in-chat signing
window, which text hosts never render: on Hermes a request parks at
`pending_signature` forever. So the agent signs with the PayBox **CLI** under
an *autonomous* grant — a key on the box that signs whatever it is handed.
The human checkpoint therefore has to live in the agent host.

Hermes has two approval surfaces: the MCP trust tier (`trust: untrusted`,
every write-capable MCP call asks) and the dangerous-command gate for the
terminal tool. The wallet tool runs through the terminal, which the trust
tier never sees; a shell hook cannot escalate (Hermes keeps only
`block`/`modify` from shell hooks). A Python plugin `pre_tool_call` hook may
return `{"action": "approve"}`, which lands the call on the same surface as
dangerous commands: a prompt in the CLI, an inline keyboard in Telegram, and
a fail-closed refusal when nobody is present.

## Decision

- `weavr/plugins/weavr-wallet-gate` escalates every signing run of the
  wallet tool — `--deployment`, `--deposit`, `--withdraw`, `--propose`,
  `--apply`, `--cancel` — with a message that names the action and the
  amount: "deposit $5 into CLAWA1", "change the mix of CLAWA1 to
  BTC:50,SOL:50 (and apply it after the notice period)". `--address` passes.
- The owner taps **Allow Once**. `Session`/`Always` persist an allowlist
  entry (`plugin_rule:weavr-wallet:paybox`) and are for dust wallets only.
- The MCP trust tier stays on for `create_portfolio` (the one write-capable
  MCP tool left in the prompt): a second, generic bubble before the wallet's.
- Non-interactive runs (`hermes chat -q`, cron without a channel) **fail
  closed**: the tool result is `BLOCKED …`, and the skill and the host brief
  tell the model to stop there.

## Consequences

- Every mainnet action of 13–14 Sep 2026 — two deposits, a create, two mix
  changes, a withdrawal — went through exactly one wallet bubble each; one
  deposit that the owner denied did not happen.
- The bubble text is the owner's whole view of what is about to be signed;
  keeping `describe()` accurate is part of adding any wallet-tool mode.
- For weavr's own agent (ADR-0008) an auto-approval *within the strategy's
  limits* may replace the button; for users' agents the button stays.
