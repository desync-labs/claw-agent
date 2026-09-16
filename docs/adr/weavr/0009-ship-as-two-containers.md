# 0009 — Ship the agent as two containers, from one public image

**Status:** accepted, 16 Sep 2026.

## Situation

The layer ran on one Ubuntu VM through `weavr/install.sh`: a venv, two
system users and a `sudo` rule so that the model's user cannot read the
PayBox key (ADR-0002). That is right for a box we operate and wrong for
everyone else: it needs root, Ubuntu, an hour, and it cannot be updated
without logging in. The people the agent is for have Docker, a Telegram
account, a model key and a PayBox wallet, and that has to be enough.

Two things had to survive the move. The key isolation: on 14 Sep 2026 a
model with file tools read the PayBox config and decoded the signing key,
which is why the key lives with another user. And the approval button:
every signature stops at a person (ADR-0005).

## Decision

- **One public image**, `ghcr.io/desync-labs/claw-agent`: the fork built
  with the upstream Dockerfile, plus `weavr/Dockerfile` on top (the wallet
  tool's node modules and the PayBox CLI, the skill fetched from
  `api.weavr.sh` at build time, the host brief, a `cont-init.d` stamp, the
  signer entrypoint). GHCR, because the fork lives on GitHub and a public
  package there needs no account to pull and no secret to push.
- **Two containers from that image.** `agent` runs the Hermes gateway and
  holds no key. `signer` runs `sign-server.mjs`, a unix socket behind which
  the wallet tool, the PayBox CLI, the login and the signing key live. The
  socket is the only thing the two share. `sign-proxy.mjs`, the agent's
  `$WEAVR_SIGN_TOOL`, gained a socket transport next to its `sudo` one; the
  seven command shapes and their checks did not change.
- **Two modes, one allowlist.** `WEAVR_AGENT_MODE=client` (create, deposit,
  withdraw) or `curator` (client plus propose, apply, cancel). The signer
  enforces it; the brief tells the model what this host can do.
- **The agent's home is generated at every start** from the image and
  `.env` (config, brief, skill, plugin), the container form of ADR-0004's
  immutable settings. Secrets are container environment; the key is a file
  in a volume mounted into the signer only.
- **`TELEGRAM_ALLOWED_USERS` is mandatory.** An empty allow-list on this
  adapter means everybody, so the stamp refuses to start without it.

## Costs

- Two containers to explain instead of one. `docs/DOCKER.md` carries that.
- The socket is trust by mount, not by user: both containers run as uid
  10000, and the key is unreadable from `agent` because it is not there,
  not because of permissions. Anyone who edits the compose file to mount
  `paybox` into `agent` has undone ADR-0002.
- PayBox signs legacy transactions only; the tool refuses v0 (address
  lookup tables) with a clear message, so portfolios stay at two or three
  assets until PayBox supports them. Documented, not solved.
- The public image carries the VM installer and the `sudo` proxy path as
  well; they are inert in containers.
- `latest` moves with releases. A user who wants a fixed version pins
  `CLAW_AGENT_TAG`.

## Alternatives

- **One container, key in a volume.** Simplest to explain; the terminal tool
  reads the key file. Rejected on the 14 Sep incident.
- **A separate signer image (node only).** Smaller signer, two images to
  version and pull. Rejected for now: one image is one thing to update and
  the tool already lives in it.
- **Docker Hub for the public image.** Where the other weavr services are.
  Rejected for the public path: pulling a private Hub repo needs a login and
  a public one needs a paid namespace for the org, while GHCR is public per
  package and pushes with the workflow token. The private curator image
  stays on Docker Hub.
- **Watchtower in the user's compose.** Automatic updates without asking.
  Rejected: a wallet-holding agent should not change under its owner; the
  README documents `pull && up -d`.
