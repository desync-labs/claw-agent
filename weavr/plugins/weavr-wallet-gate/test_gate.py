"""Planted cases for the money gate. Pure Python, no Hermes import:
``python test_gate.py`` or pytest."""
import importlib.util
import pathlib

_spec = importlib.util.spec_from_file_location("weavr_wallet_gate", pathlib.Path(__file__).with_name("__init__.py"))
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
gate = _mod.gate


def test_ignores_other_tools_and_plain_commands():
    assert gate(tool_name="mcp__weavr__list_assets", args={}) is None
    assert gate(tool_name="terminal", args={"command": "ls -la"}) is None
    assert gate(tool_name="terminal", args={"command": "node $WEAVR_SIGN_TOOL --address"}) is None


def test_escalates_signing_runs_with_a_named_action():
    r = gate(tool_name="terminal", args={"command": "node $WEAVR_SIGN_TOOL --deployment 5ed63540-645e"})
    assert r["action"] == "approve"
    assert "deployment 5ed63540-645e" in r["message"] and "signer paybox" in r["message"]
    assert r["rule_key"] == "weavr-wallet:paybox"
    r = gate(tool_name="terminal", args={"command": 'cd /x && node "${WEAVR_SIGN_TOOL}" --deposit CLAWR2 --amount 0.5'})
    assert "deposit $0.5 into CLAWR2" in r["message"]
    r = gate(tool_name="terminal", args={"command": "node /x/sign-local.mjs --tx AAAA"})
    assert r["action"] == "approve" and "signer local" in r["message"]
    r = gate(tool_name="terminal", args={"command": "node /x/sign-solana.mjs --file p.json --send"})
    assert "sign a saved payload and send it" in r["message"]
    r = gate(tool_name="terminal", args={"command": "node /opt/weavr-signer/tools/sign-proxy.mjs --deposit CLAWR3 --amount 1"})
    assert r["action"] == "approve" and "deposit $1 into CLAWR3" in r["message"] and "signer paybox" in r["message"]


def test_vetoes_self_modification_and_wallet_snooping():
    # 14 Sep 2026: the model set approvals.single_query_mode itself, then signed.
    for cmd in [
        "hermes config set approvals.single_query_mode approve",
        "cd /tmp && hermes plugins disable weavr-wallet-gate",
        "hermes mcp remove weavr",
        "sed -i s/deny/approve/ ~/.config/weavr/demo/hermes-home/config.yaml",
        "cat $HERMES_HOME/.env",
        "echo x >> /home/hermes/.config/weavr/demo/hermes-home/.env",
    ]:
        r = gate(tool_name="terminal", args={"command": cmd})
        assert r and r["action"] == "block" and "owner" in r["message"], cmd
    # ... and read the wallet tool's code and directory looking for keys.
    for cmd in [
        "cat /opt/weavr-signer/tools/sign-proxy.mjs",
        "ls -la /opt/weavr-signer/tools/",
        "ls /var/lib/weavr-signer/paybox",
        "cat ~/.config/weavr/demo/paybox-cli/signing-key.txt",
        "env | grep PAYBOX_",
        "node $WEAVR_SIGN_TOOL --help",
        "node /opt/weavr-signer/tools/sign-proxy.mjs --deposit CLAWR3 --amount 1 && cat /etc/passwd",
    ]:
        r = gate(tool_name="terminal", args={"command": cmd})
        assert r and r["action"] == "block" and "one command at a time" in r["message"], cmd
    # the three invocations still pass (and the signing ones still escalate)
    assert gate(tool_name="terminal", args={"command": "node $WEAVR_SIGN_TOOL --address"}) is None
    assert gate(tool_name="terminal", args={"command": "cd /opt/weavr-signer/tools && ./sign-proxy.mjs --address"}) is None
    r = gate(tool_name="terminal", args={"command": 'cd /home/hermes; node "$WEAVR_SIGN_TOOL" --deposit CLAWR3 --amount 1'})
    assert r["action"] == "approve" and "deposit $1 into CLAWR3" in r["message"]
    r = gate(tool_name="terminal", args={"command": "/opt/weavr-signer/tools/sign-proxy.mjs --deployment 5ed63540-645e-4b1c"})
    assert r["action"] == "approve" and "deployment 5ed63540-645e-4b1c" in r["message"]
    # unrelated commands are not this plugin's business — including a user's own config.yaml
    # or .env in an agent that also does other work
    assert gate(tool_name="terminal", args={"command": "date"}) is None
    assert gate(tool_name="terminal", args={"command": "cat ./config.yaml && cat .env"}) is None
    assert gate(tool_name="terminal", args={"command": "sed -i s/a/b/ /home/me/project/config.yaml"}) is None
    assert gate(tool_name="terminal", args={"command": "hermes --version"}) is None
    assert gate(tool_name="terminal", args={"command": "cat ~/.hermes/config.yaml"})["action"] == "block"
    assert gate(tool_name="read_file", args={"path": "/etc/hostname"}) is None


if __name__ == "__main__":
    test_ignores_other_tools_and_plain_commands()
    test_escalates_signing_runs_with_a_named_action()
    test_vetoes_self_modification_and_wallet_snooping()
    print("wallet gate: ok")
