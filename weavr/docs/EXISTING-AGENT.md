# weavr on an agent you already run

The layout in this repository (`install.sh`) is for a **dedicated** weavr
agent: its own user, the keys under another user, the tool set trimmed. If
you already run a Claw Agent for other things and want weavr in it, this is
the shorter path. It keeps the keys in *your* home, so it is for a **small,
dedicated wallet only** (ADR-0002 says why), and you still get the approval
button on every signature.

Adapted from weavr's 7 Sep 2026 export (`desync-labs/weavr-claw-agent`, now
superseded by this repository); the wallet tool here has seven commands, not
three, and the gate also refuses attempts to change the agent's settings.

## Setup

You need a Claw Agent install with a model provider configured, Node.js 20 or newer, and a PayBox account with a **dedicated, small** Solana wallet for the agent. `claw` and `hermes` are the same command.

### 1. Add weavr to the agent

```bash
claw mcp add weavr --url https://api.weavr.sh/mcp      # lists 30 tools, asks to enable them: Y
```

In `~/.hermes/config.yaml`, make the weavr entry match the one in `config.yaml` here (`trust: untrusted`, `resources: false`, `prompts: false`, the `include` list of twelve tools). Then give the agent the skill:

```bash
mkdir -p ~/.hermes/skills/weavr
curl -s https://api.weavr.sh/hosts/hermes/SKILL.md -o ~/.hermes/skills/weavr/SKILL.md
claw mcp test weavr                                     # Connected
```

### 2. PayBox

```bash
mkdir -p ~/weavr-wallet/tools && cd ~/weavr-wallet/tools && npm i @paybox-sh/sdk@0.8.5
export PAYBOX_CONFIG_DIR=~/weavr-wallet/paybox PAYBOX_CLI=$PWD/node_modules/@paybox-sh/sdk/dist/cli.js
mkdir -p -m 700 "$PAYBOX_CONFIG_DIR"
node "$PAYBOX_CLI" login --no-provision                 # open the printed URL on your phone, approve with your passkey
node "$PAYBOX_CLI" --json credentials                   # the id of the wallet the agent will use
```

In the PayBox app, on the **Clients** screen, give this client **Full Access** to that one wallet and nothing else.

### 3. This repo

```bash
git clone -b weavr https://github.com/desync-labs/claw-agent ~/weavr-wallet/tools/claw-agent
cd ~/weavr-wallet/tools/claw-agent/weavr && npm i
cp -r weavr/plugins/weavr-wallet-gate ~/.hermes/plugins/ && claw plugins enable weavr-wallet-gate
```

Add to `~/.hermes/.env` (`chmod 600`), with your paths:

```
PAYBOX_CONFIG_DIR=/home/you/weavr-wallet/paybox
PAYBOX_CREDENTIAL_ID=<wallet credential id>
PAYBOX_CLI=/home/you/weavr-wallet/tools/node_modules/@paybox-sh/sdk/dist/cli.js
WEAVR_SIGN_TOOL=/home/you/weavr-wallet/tools/claw-agent/weavr/tools/sign-solana.mjs
```

### 4. The signing key, and the proof

```bash
set -a; . ~/.hermes/.env; set +a
node weavr/tools/sign-check.mjs
```

The first run fails and prints a `clientId`. Mint a key at `https://app.paybox.sh/agent-key?client_id=<clientId>` and save it as the only line of `$PAYBOX_CONFIG_DIR/signing-key.txt` (`chmod 600`). Never paste it into a chat. Run the check again until it prints `{"status":"ok", ...}`: it signs a test message that can never be sent and spends nothing.

Then prove the gate:

```bash
claw chat -q "Deposit 5 dollars into my MAJ portfolio."   # must end: BLOCKED ... (Wallet action: deposit ...)
```

### 5. Use it

`claw chat`, or over Telegram after `claw gateway setup` and `claw gateway run`. A thesis, a mix, a name and a ticker, a simulation, "create it". Two approvals follow: the first reserves the portfolio (nothing signed yet), the second, **"Wallet action: sign the create for deployment ..."**, is the money step. Answer **once** to each. Deposits are one approval. Up to four assets per portfolio with PayBox; four means two transactions behind one approval.

## What the tool refuses

| Answer | Meaning |
|---|---|
| `LEGACY_ONLY` | too many assets for this wallet; use four or fewer |
| `WRONG_PAYER`, `FOREIGN_PROGRAM` | not this wallet's transaction, or not a weavr program: refused on purpose |
| `WALLET_DECLINED` | PayBox did not sign; run `sign-check.mjs` |
| `CONFIG` | a missing variable, named |
| `BUSY` | another signing run holds the lock; wait ten seconds |

## Tests

```bash
npm test                     # the checks on planted violations, the tool through a fake PayBox CLI, the sign check
npm run gate-test            # the approval plugin
```

No key, network or money is involved in the tests.
