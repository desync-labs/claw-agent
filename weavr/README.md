# The weavr layer

What turns this ClawPump-derived Hermes fork into the **weavr agent**: an
agent that creates and curates onchain portfolios from a thesis, signs
through PayBox, and asks its owner in Telegram before every signature.
Decisions and their reasons: [`docs/adr/weavr/`](../docs/adr/weavr/README.md).

## Run with Docker

You need Docker (Compose v2), a Telegram bot token from @BotFather, your
numeric Telegram id, a model key (OpenAI by default) and a PayBox account
with a wallet. Keep the wallet small: PayBox signs anything the key is
handed, and the Telegram button is the only limit today.

```bash
git clone https://github.com/desync-labs/claw-agent.git && cd claw-agent/weavr
cp env.example .env && chmod 600 .env        # fill in OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS
docker compose run --rm signer setup         # PayBox login, paste the pbxk1. key, copy PAYBOX_CREDENTIAL_ID into .env
docker compose run --rm signer check         # signs a memo that can never land: {"status":"ok","address":…}
docker compose up -d                         # the Telegram gateway
```

In Telegram: `/new`, then talk. Ask for a deposit and you get a button that
names the action; nothing is signed until you press it.

Two containers come up: `agent` (the model, the skill, the button; no key)
and `signer` (the PayBox CLI and the key, behind one socket that only
accepts the seven wallet commands). `WEAVR_AGENT_MODE` in `.env` picks what
the wallet may do:

| Mode | Wallet commands |
|---|---|
| `client` (default) | create a portfolio, deposit, withdraw |
| `curator` | the same, plus change the mix of a portfolio this wallet curates |

Update with `docker compose pull && docker compose up -d`. Everything else
(every setting, the volumes, the refusals and what they mean, building the
image yourself) is in [`docs/DOCKER.md`](docs/DOCKER.md).

PayBox signs legacy transactions only; a portfolio wide enough to need an
address lookup table is refused by the tool with a clear message. Two or
three assets per portfolio is the working range today.

## What is here

| Path | What |
|---|---|
| `docker-compose.yml`, `env.example` | the two-container layout and its settings ([docs/DOCKER.md](docs/DOCKER.md)) |
| `Dockerfile` | the public image `ghcr.io/desync-labs/claw-agent`: the fork plus this layer; `docker/` holds the start-up stamp and the signer entrypoint |
| `config.yaml` | the agent's Hermes config: tool set, weavr MCP (12 tools), approvals; the model block comes from `.env` |
| `AGENTS.md` | the host brief, loaded into every system prompt from the agent's home |
| `tools/sign-proxy.mjs` | what the agent's `$WEAVR_SIGN_TOOL` points at: seven command shapes, then the socket (containers) or sudo (VM) |
| `tools/sign-server.mjs` | the signer container: the socket, the mode allowlist, the wallet tool |
| `tools/sign-solana.mjs` | the wallet tool proper (PayBox CLI signer + weavr flows); `sign-local.mjs` the dust-keypair control; `sign-check.mjs` the pre-flight |
| `tools/lib/` | transaction checks (`tx-checks.mjs`), weavr flows (`weavr.mjs`), the two signers, the shared CLI |
| `plugins/weavr-wallet-gate/` | the approval gate and the vetoes (Hermes plugin) |
| `manifest.json` | the weavr program allowlist the wallet tool checks every transaction against |
| `install.sh`, `agentctl`, `signer/` | the VM alternative: agent user, venv, keys under a second user with one sudo rule |
| `curator/`, `Makefile` | the private curator image for the weavr team's own VM (not part of the public path) |
| `patches/` | the trust-gate fix (applied in this fork) and its test |
| `tests/` | `npm test`: the tool, the proxy, the socket signer, the flows, the gate — no key, no network, no money |

## Install on a VM instead

The same agent without containers, as root on Ubuntu 22.04/24.04: keys
under a second system user, one `sudo` rule, systemd for the gateway.

```bash
git clone https://github.com/desync-labs/claw-agent.git && cd claw-agent
sudo weavr/install.sh --agent-user hermes \
     --telegram-token-file /root/telegram-bot-token.txt --telegram-user <your numeric Telegram id>
```

Then PayBox, once, as the signer (the installer prints the exact commands),
and the proofs before any money:

```bash
node /opt/weavr-signer/tools/sign-proxy.mjs --address   # the wallet
cat /opt/weavr-signer/env                             # permission denied
hermes chat -Q -q "Deposit 1 dollar into CLAWR3."     # ends in BLOCKED — no human in -q
weavr-agentctl start
```

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

The model never holds a key, a token or a transaction: the key sits in the
signer container (or under the `weavr-signer` user on a VM), the agent's
only way to it is one socket (one `sudo` command on a VM), and that path
takes seven shapes and nothing else, fewer in client mode. Every signing
shape stops at a Telegram button that names the action. The agent's config,
brief and skill are rewritten from the image at every start, its tool set
is the terminal plus the skill reader, and a plugin refuses any attempt to
change host settings or to read the wallet's files. Two incidents on 14 Sep
2026 drove the last two of those (ADR-0002, ADR-0004); both are now tests.

## weavr on an agent you already run

[`docs/EXISTING-AGENT.md`](docs/EXISTING-AGENT.md): the shorter, single-user
path — the wallet tool and the gate in your own `~/.hermes`, keys in your
home, a small dedicated wallet. It supersedes `desync-labs/weavr-claw-agent`
(the 7 Sep 2026 export of the same pieces).

## Rehearsal wallets

Keep them small. PayBox's grant is autonomous with no spend limit yet; the
button is the only limit today. A per-wallet spend limit on PayBox's side is
the next control before a wallet that holds more than test money.
