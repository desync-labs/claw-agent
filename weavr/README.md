# The weavr layer

What turns this ClawPump-derived Hermes fork into the **weavr agent**: an
agent that creates and curates onchain portfolios from a thesis, signs
through PayBox, and asks its owner in Telegram before every signature.
Decisions and their reasons: [`docs/adr/weavr/`](../docs/adr/weavr/README.md).

## What is here

| Path | What |
|---|---|
| `install.sh` | one-shot installer, as root: agent user, venv, config, skill, gate plugin, host brief, signer, systemd gateway |
| `agentctl` | `weavr-agentctl start / stop / status / logs` for the Telegram gateway |
| `config.yaml` | the agent's Hermes config: model, tool set, weavr MCP (12 tools), approvals |
| `AGENTS.md` | the host brief, loaded into every system prompt from the agent's home |
| `env.example` | environment names only; the real `.env` is written by the installer |
| `tools/sign-proxy.mjs` | what the agent's `$WEAVR_SIGN_TOOL` points at: seven commands, then sudo to the signer |
| `tools/sign-solana.mjs` | the wallet tool proper (PayBox CLI signer + weavr flows); `sign-local.mjs` the dust-keypair control; `sign-check.mjs` the pre-flight |
| `tools/lib/` | transaction checks (`tx-checks.mjs`), weavr flows (`weavr.mjs`), the two signers, the shared CLI |
| `signer/` | `install.sh` puts the tool and the keys under the `weavr-signer` user; `weavr-sign` is the sudo target |
| `plugins/weavr-wallet-gate/` | the approval gate and the vetoes (Hermes plugin) |
| `patches/` | the trust-gate fix (applied in this fork) and its test |
| `manifest.json` | the weavr program allowlist the wallet tool checks every transaction against |
| `tests/` | `npm test`: the tool, the proxy, the flows, the gate — no key, no network, no money |

## Quickstart (Ubuntu 22.04/24.04, as root)

```bash
git clone https://github.com/desync-labs/claw-agent.git && cd claw-agent      # branch weavr
sudo weavr/install.sh --agent-user hermes \
     --telegram-token-file /root/telegram-bot-token.txt --telegram-user <your numeric Telegram id>
```

Then PayBox, once, as the signer (the installer prints the exact commands):
log in with the device code, mint the `pbxk1.` signing key in the browser,
save it to `/var/lib/weavr-signer/paybox/signing-key.txt`, rerun
`signer/install.sh --credential-id <wallet credential id>`, and run the
pre-flight `sign-check.mjs` (signs a memo that can never land).

Proofs before any money, as the agent user:

```bash
node /opt/weavr-signer/tools/sign-proxy.mjs --address   # the wallet (the agent itself uses $WEAVR_SIGN_TOOL, set in its .env)
cat /opt/weavr-signer/env                             # permission denied
hermes mcp test weavr                                 # Connected, 12 tools
hermes chat -Q -q "Deposit 1 dollar into CLAWR3."     # ends in BLOCKED — no human in -q
```

Start the gateway: `weavr-agentctl start`. In Telegram: `/new`, then talk.

## Images (the GCP agent VM)

`make -C weavr image` builds the fork as `intothefathom/claw-agent` with the
upstream Dockerfile; `make -C weavr curator OPS_REF=<ops branch>` layers the
curator profile and plugin from `composable-portfolios-ops` on top of it as
`intothefathom/weavr-curator-agent` (`weavr/curator/Dockerfile`). Tags follow
the other weavr services: `<sha>-dev` and `dev` off a branch. The VM in
`weavr-infrastructure` (`modules/curator-agent`, ADR-0018 there) follows the
`dev` tag through Watchtower and renders the container's environment from
1Password, so a merged change here or in the ops profile is a rebuild, not a
login. `.github/workflows/weavr-image.yml` does the same build on push.

## What the agent can do

| Ask | What happens | Button |
|---|---|---|
| "My thesis: Bitcoin and Solana. Which assets?" | `list_assets` | none |
| "Create Claw Auto One, CLAWA1, 60% BTC 40% SOL" | simulate → create_portfolio → `--deployment` → live | MCP trust bubble, then "sign the create for deployment …" |
| "Deposit 5 dollars into CLAWA1" | `--deposit CLAWA1 --amount 5` | "deposit $5 into CLAWA1" |
| "Rebalance CLAWA1: propose a better mix and apply it" | reads, `simulate_rebalance`, `--propose … --mix …` (apply in the same run when the notice period is short) | "change the mix of CLAWA1 to …" |
| "Withdraw all my shares from CLAWA1" | `--withdraw CLAWA1 --shares all` → a queued request weavr pays in order | "withdraw all shares from CLAWA1" |

Every one of these ran on Solana mainnet on 13–14 Sep 2026 through this
layout, on a hosted and on a local model.

## Security model in one paragraph

The model never holds a key, a token or a transaction: the keys sit under
`weavr-signer`, the agent user has no sudo beyond one command, and that
command takes seven shapes and nothing else. Every signing shape stops at a
Telegram button that names the action. The agent's own config, env and
brief are immutable, its tool set is the terminal plus the skill reader, and
a plugin refuses any attempt to change host settings or to read the wallet's
files. Two incidents on 14 Sep 2026 drove the last two of those (ADR-0002,
ADR-0004); both are now tests.

## weavr on an agent you already run

[`docs/EXISTING-AGENT.md`](docs/EXISTING-AGENT.md): the shorter, single-user
path — the wallet tool and the gate in your own `~/.hermes`, keys in your
home, a small dedicated wallet. It supersedes `desync-labs/weavr-claw-agent`
(the 7 Sep 2026 export of the same pieces).

## Rehearsal wallets

Keep them small. PayBox's grant is autonomous with no spend limit yet; the
button is the only limit today. A per-wallet spend limit on PayBox's side is
the next control before a wallet that holds more than test money.
