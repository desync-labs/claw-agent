# Fork patches

Pinned fork: `Clawpump/claw-agent` **7b81ee9** (28 Aug 2026, "fix(package): exclude
desktop release artifacts"), upstream `hermes-agent 0.20.6`. Re-verify every
item here after each upstream sync; the fix is one line by function name so it
survives a rebase.

## 1. Trust gate reads the wrong field (required)

`tools/mcp_tool.py::_annotation_read_only_hint` reads `annotations.readOnlyHint`
with `getattr`; mcp ≥ 2.0 (the fork installs 2.0.0) renamed the SDK field to
`read_only_hint`, so the tier records every tool on an `untrusted` server as
write-capable and the reads ask for consent too. Replace the `getattr` line with
`mcp_field(annotations, "read_only_hint", "readOnlyHint")` — the helper the same
file already uses for every other renamed field. Diff: `trust-gate-read-only-hint.patch`,
a unified diff against 7b81ee9 (`patch -p1 < …` or `git apply …` from the fork
checkout; the first version of the file had a bare hunk header that `patch(1)`
rejected as garbage, found 6 Sep when a fresh clone stayed unpatched).
Test: `test_trust_gate.py` (run inside the fork venv). Verified 6 Sep 2026: the
SDK object gives `True` after the fix and `None` before; `hermes mcp test weavr`
still discovers 30 tools; in a live gateway session the reads ran freely and
`create_portfolio` asked.

PRs (6 Sep 2026): fork **Clawpump/claw-agent#33**, targeting main = 7b81ee9,
carries this line plus two tests on real `mcp.types.Tool` / `ToolAnnotations`
objects in `tests/tools/test_mcp_trust_gating.py` (both fail unpatched, 13/13
patched). Upstream NousResearch/hermes-agent moved the function to
`tools/mcp_tool_registration.py` in the 2 Sep split and tracks the bug as
**#88858**; three competing fixes are open (#94891, #101998, #103177; #88372
audits the whole rename) and triage closes every newer one as a duplicate.
Our split-module fix with the same tests is pushed to
`dmtrbch/hermes-agent:fix/mcp-trust-gate-read-only-hint` and deliberately not
opened as a fourth PR. Whichever lands, the fork inherits it at its next
maintainer-merged sync — re-check this item after every sync.

## 2. The money gate is a plugin hook, not the trust tier (no fork change)

`trust: untrusted` gates direct MCP calls. The wallet tool signs and sends
through the **terminal** tool, which the tier never sees, so a deposit through
the wrapper had no approval at all (observed 6 Sep 10:02Z). The gate that
covers money is the plugin in `../plugins/weavr-wallet-gate`: its
`pre_tool_call` hook matches `sign-solana.mjs` / `sign-local.mjs` /
`$WEAVR_SIGN_TOOL` signing runs (quoted or not) and returns
`{"action": "approve", "message": ..., "rule_key": ...}`, which
`tools/approval.py::request_tool_approval` escalates to the same human
approval surface Tier-2 dangerous commands use (terminal prompt, Telegram
buttons, `[o]nce/[s]ession/[a]lways/[d]eny`), with a message that names the
action ("deposit $5 into CLAWR2 (signer paybox)"). Non-interactive runs fail
closed. Verified 6 Sep 10:27Z: `hermes chat -q "Deposit 5 dollars…"` stopped at
"BLOCKED: Tool 'terminal' requires approval (Wallet action: deposit $5 into
CLAWR2 …)" and signed nothing.

A **shell** hook cannot do this — tried first (10:19Z) and the deposit went
through: `agent/shell_hooks.py` keeps only `block` / `modify` from shell-hook
output. User plugins are "not enabled" until `hermes plugins enable
weavr-wallet-gate` (the enable prints a harmless tools-override capability
note; the plugin defines no tools). Test: `python plugins/weavr-wallet-gate/test_gate.py`,
also run by `tests/unit/integrations`.

Keep `trust: untrusted` as well: it still covers a model that calls
`create_portfolio`, `send_signed` or a `build_*` tool directly, and the generic
consent text there is the reason the hook message must say what is happening.
