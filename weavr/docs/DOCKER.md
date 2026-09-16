# The weavr agent with Docker

Everything the `Run with Docker` section of [`../README.md`](../README.md)
leaves out: what the two containers are, every setting, what is stored
where, how to update, and what to do when something refuses.

## The two containers

| Container | Runs as | Holds | Can do |
|---|---|---|---|
| `agent` | Hermes gateway (Telegram), the weavr skill, the approval gate | your model key, the bot token, the allow-list | read weavr, talk to you, and ask the signer over one socket |
| `signer` | `sign-server.mjs` with the PayBox CLI | PayBox login, the `pbxk1.` signing key, the credential id | the seven wallet commands of the current mode, nothing else |

They share one named volume, `weavr-sign`, that contains a single unix
socket. The agent's `$WEAVR_SIGN_TOOL` is a proxy that writes one JSON line
to that socket and prints the answer. The signer checks the request twice
(shape, then mode), runs the wallet tool, and returns its one-line JSON. The
key never leaves the `paybox` volume, which is mounted into `signer` only.

This is the container form of the layout the VM installer builds with a
second system user and `sudo` ([ADR-0002](../../docs/adr/weavr/0002-keys-under-their-own-user.md));
see [ADR-0009](../../docs/adr/weavr/0009-ship-as-two-containers.md) for why.

## Modes

Set `WEAVR_AGENT_MODE` in `.env`; both containers read it.

| Mode | Wallet commands | For |
|---|---|---|
| `client` (default) | `--address`, `--deployment` (finish a create), `--deposit`, `--withdraw` | anyone who creates portfolios and moves their own money |
| `curator` | client + `--propose --mix`, `--apply`, `--cancel` | the curator of a portfolio: change its mix, with a notice period the API enforces |

In `client` mode a rebalance request is refused by the signer with
`{"error":"MODE"}`; the brief tells the model to say so and stop. Changing
the mode is an edit of `.env` and `docker compose up -d`.

## Settings (`.env`)

| Variable | Required | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | with the default provider | the model. `HERMES_MODEL` (default `gpt-5.4`), `HERMES_PROVIDER` (default `openai-api`) |
| `ANTHROPIC_API_KEY` | with `HERMES_PROVIDER=anthropic` | e.g. `HERMES_MODEL=claude-sonnet-5` |
| `HERMES_BASE_URL`, `HERMES_API_KEY`, `HERMES_CONTEXT_LENGTH` | with `HERMES_PROVIDER=custom` | a local OpenAI-compatible server; 128k+ context, see ADR-0007. From a container, the host is `host.docker.internal` |
| `TELEGRAM_BOT_TOKEN` | yes | from @BotFather |
| `TELEGRAM_ALLOWED_USERS` | yes | numeric ids, comma-separated. Empty: the agent refuses to start (nobody may talk to it, and an empty list would mean everybody) |
| `PAYBOX_CREDENTIAL_ID` | yes, after setup | printed by `docker compose run --rm signer setup` |
| `WEAVR_AGENT_MODE` | no | `client` or `curator` |
| `CLAW_AGENT_TAG` | no | image tag, default `latest`; pin a version with `v1.2.0` |
| `WEAVR_MCP_URL`, `WEAVR_API_URL` | no | defaults to `https://api.weavr.sh` |

The signing key is not a variable. It lives in the `paybox` volume as
`signing-key.txt` (0600), written by `setup`, read by the signer only.

## What is stored where

| Volume | Content | Loses what if deleted |
|---|---|---|
| `hermes-home` | the agent's state: conversations, `state.db`, logs; the config, brief, skill and plugin are rewritten at every start | chat history and memory; nothing you cannot recreate |
| `paybox` | PayBox login (`config.json`), the signing key, the CLI's work dir | the wallet's signing ability: run `setup` again, mint a new key |
| `weavr-sign` | the socket | nothing |

`config.yaml`, `AGENTS.md`, the skill and the gate plugin are generated at
every container start from the image and `.env`
([ADR-0004](../../docs/adr/weavr/0004-immutable-settings-and-self-modification-veto.md)):
an edit inside the container does not survive a restart, and the model has
no file tools to make one.

## Commands

```bash
docker compose run --rm signer setup      # once: PayBox login, key, credential id
docker compose run --rm signer check      # signs a memo that can never land; prints the address
docker compose run --rm signer address    # the wallet address
docker compose run --rm signer paybox credentials --json   # the PayBox CLI directly
docker compose up -d                      # both containers
docker compose logs -f agent              # the gateway
docker compose logs -f signer             # one line per signing request: mode, argv, exit code
docker compose exec agent hermes chat -Q -q "Deposit 1 dollar into CLAWR3."   # must end in BLOCKED: no human in -q
```

## Updating

```bash
docker compose pull && docker compose up -d
```

`latest` follows releases; `dev` follows the branch. The `paybox` volume is
untouched by an update. To go back, set `CLAW_AGENT_TAG` to the previous
version in `.env` and `up -d` again.

## When something refuses

| You see | Meaning | Do |
|---|---|---|
| agent exits at start, log says `TELEGRAM_ALLOWED_USERS is empty` | the allow-list is the one setting without a safe default | put your numeric id in `.env` |
| `{"error":"CONFIG","detail":"signer not reachable …"}` | the signer container is not up | `docker compose ps`, `docker compose logs signer` |
| `{"error":"CONFIG","detail":"missing PAYBOX_CREDENTIAL_ID"}` | setup not finished | `docker compose run --rm signer setup`, copy the id into `.env`, `up -d` |
| `{"error":"MODE"}` | a curator command in client mode | `WEAVR_AGENT_MODE=curator` if this wallet curates the portfolio |
| `{"error":"REFUSED","detail":"this transaction is versioned (v0) …"}` | the API built a transaction with an address lookup table; PayBox signs legacy transactions only | keep portfolios to two or three assets; wider ones cannot be signed through PayBox today |
| `WALLET_DECLINED … revoked` | PayBox revoked the signing key | mint a new one: `setup` again |
| `BLOCKED` in a `-q` chat | expected: signing needs a human, and `-q` has none | talk to the bot in Telegram instead |
| `[config-migrate] WARNING … run hermes setup` once, at the first start | the image seeds its own default config before the weavr stamp replaces it | nothing; do not run `hermes setup` |

## Building the image yourself

```bash
make -C weavr base-build      # the fork with the upstream Dockerfile, ~10 min, tagged hermes-base:<sha>
make -C weavr public-build    # weavr/Dockerfile on top: ghcr.io/desync-labs/claw-agent:<sha>-dev and :dev
```

`docker compose` then needs `CLAW_AGENT_TAG=<sha>-dev` in `.env`. The
GitHub workflow `.github/workflows/weavr-public-image.yml` does the same on
push and publishes to GHCR.
