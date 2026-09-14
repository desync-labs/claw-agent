"""weavr-wallet-gate — a Hermes plugin hook that is the money gate.

The MCP trust tier gates direct MCP calls only. The weavr wallet tool signs and
sends through the *terminal* tool, which the tier never sees, and a shell hook
cannot help: Hermes normalises shell-hook output to ``block`` / ``modify``. A
Python plugin ``pre_tool_call`` hook may return ``{"action": "approve"}``, which
escalates the call to the same human approval surface Tier-2 dangerous
commands use (terminal prompt, Telegram buttons; non-interactive runs fail
closed). This one does exactly that for signing runs, with a message that says
what is about to happen.

It also vetoes two things outright (``{"action": "block"}``), because on
14 Sep 2026 a model did both to get past the gate: it ran
``hermes config set approvals.single_query_mode approve`` (the BLOCKED text
names that setting) and then signed; and it read the wallet tool's source and
directory looking for keys. So:

- any terminal command that drives the ``hermes`` CLI, or names the agent's
  own config (``config.yaml``, ``.env``, ``HERMES_HOME``) is blocked — the
  agent does not change this host's settings;
- any terminal command that mentions the wallet tool or its directory but is
  not one of its three invocations is blocked — the tool has three commands
  and nothing else in its directory is part of a weavr action.

Install: copy or symlink this directory to ``$HERMES_HOME/plugins/weavr-wallet-gate``.
No configuration; ``hermes plugins list`` shows it. Test: ``python test_gate.py``.
"""
from __future__ import annotations

import re

# `node $WEAVR_SIGN_TOOL …`, `node "${WEAVR_SIGN_TOOL}" …` or the file path, quoted or not.
# sign-proxy.mjs is the agent-side face of sign-solana.mjs once the keys sit with weavr-signer.
PATTERN = re.compile(r"(?:sign-(solana|local|proxy)\.mjs|\$\{?WEAVR_SIGN_TOOL\}?)[\"']?\s+(.*)$")
SIGNING_FLAGS = re.compile(r"--(deployment|deposit|withdraw|propose|apply|cancel|file|tx)\b")

# One invocation of the wallet tool, optionally behind `cd <dir> &&` / `;` and `node`, and nothing
# else on the line. The grammar is the tool's own (--file / --tx are the single-user layout's
# fallbacks; the proxy refuses them anyway); the signing ones still go through the approval below.
INVOCATION = re.compile(
    r"^\s*(?:cd\s+\S+\s*(?:&&|;)\s*)?(?:node\s+)?[\"']?(?:\S*sign-(?:solana|local|proxy)\.mjs|\$\{?WEAVR_SIGN_TOOL\}?)[\"']?"
    r"\s+(?:--address|--deployment\s+\S+|--deposit\s+\S+\s+--amount\s+\S+|--amount\s+\S+\s+--deposit\s+\S+"
    r"|--withdraw\s+\S+\s+--shares\s+\S+|--shares\s+\S+\s+--withdraw\s+\S+"
    r"|--propose\s+\S+\s+--mix\s+\S+|--mix\s+\S+\s+--propose\s+\S+|--apply\s+\S+|--cancel\s+\S+"
    r"|--file\s+\S+(?:\s+--send|\s+--await\s+\S+)?|--tx\s+\S+(?:\s+--tx\s+\S+)*)\s*$"
)
# Where the wallet tool and its keys live (single-user and weavr-signer layouts).
WALLET_PATHS = re.compile(r"weavr-signer|WEAVR_SIGN_TOOL|sign-(?:solana|local|proxy)\.mjs|paybox-cli|PAYBOX_|signing-key")
# The agent's own settings: the hermes CLI subcommands that change them, and Hermes' own
# config.yaml / .env — only under its home, so a user's project config.yaml or .env (an agent
# that also does other work) is none of this plugin's business.
SELF_MODIFICATION = re.compile(
    r"(?:^|[\s;&|(`])hermes\s+(?:config|plugins?|mcp|approvals|setup|secrets|tools|skills|hooks|profile|auth)\b"
    r"|\$\{?HERMES_HOME\}?|(?:hermes-home|\.hermes)/[^\s]*(?:config\.yaml|\.env)\b"
)


def describe(tail: str) -> str:
    """A human sentence for the wallet action in ``tail`` (the tool's arguments)."""
    dep = re.search(r"--deployment\s+(\S+)", tail)
    if dep:
        return f"sign the create for deployment {dep.group(1)} and wait until it is live"
    depo = re.search(r"--deposit\s+(\S+)\s+--amount\s+(\S+)", tail)
    if depo:
        return f"deposit ${depo.group(2)} into {depo.group(1)}"
    wd = re.search(r"--withdraw\s+(\S+)(?:.*--shares\s+(\S+))?", tail)
    if wd:
        return f"withdraw {wd.group(2) or 'some'} shares from {wd.group(1)}"
    prop = re.search(r"--propose\s+(\S+)(?:.*--mix\s+(\S+))?", tail)
    if prop:
        return f"change the mix of {prop.group(1)} to {prop.group(2) or 'a new mix'} (and apply it after the notice period)"
    for flag, verb in (("apply", "apply the pending mix change of"), ("cancel", "cancel the pending mix change of")):
        m = re.search(rf"--{flag}\s+(\S+)", tail)
        if m:
            return f"{verb} {m.group(1)}"
    if "--file" in tail:
        suffix = " and send it" if "--send" in tail else " and wait for the portfolio" if "--await" in tail else ""
        return "sign a saved payload" + suffix
    if "--tx" in tail:
        return "sign a transaction handed in on the command line"
    return "sign with the agent wallet"


def veto(command: str) -> str | None:
    """The reason a terminal command is refused outright, or None."""
    if SELF_MODIFICATION.search(command):
        return ("This host's settings, approvals and configuration are the owner's, not the agent's: "
                "the command is refused. If a weavr action needs an approval, ask the owner for it.")
    if WALLET_PATHS.search(command) and not INVOCATION.match(command):
        return ("The wallet tool is run one command at a time, nothing before or after it on the line: "
                "`node $WEAVR_SIGN_TOOL --address`, `--deployment <deploymentId>`, `--deposit <ticker> --amount <usd>`, "
                "`--withdraw <ticker> --shares <n|all>`, `--propose <ticker> --mix BTC:60,SOL:40`, `--apply <ticker>`, "
                "`--cancel <ticker>`. Nothing else in its "
                "directory, its code or its keys is part of a weavr action: the command is refused.")
    return None


def gate(tool_name: str | None = None, args: dict | None = None, **kwargs):
    """pre_tool_call: veto self-modification and wallet snooping; escalate signing runs; ignore the rest."""
    if tool_name != "terminal":
        return None
    command = str((args or {}).get("command") or "")
    reason = veto(command)
    if reason:
        return {"action": "block", "message": reason}
    match = PATTERN.search(command)
    if not match:
        return None
    tail = match.group(2)
    if not SIGNING_FLAGS.search(tail):
        return None  # --address and other read-only uses
    signer = "local" if match.group(1) == "local" else "paybox"
    return {
        "action": "approve",
        "message": f"Wallet action: {describe(tail)} (signer {signer}). Approve to let the agent wallet sign.",
        "rule_key": f"weavr-wallet:{signer}",
    }


def register(ctx):
    ctx.register_hook("pre_tool_call", gate)
