# ADR-0002 — The keys live under their own system user; the agent gets a seven-command proxy

**Status:** accepted · **Date:** 14 Sep 2026

## Context

The wallet tool (`weavr/tools/sign-solana.mjs`, from weavr's ops repository)
signs weavr transactions with the PayBox CLI using a `pbxk1.` signing key
read from a file. In the first layout the key, the PayBox OAuth config
(`config.json`, with the refresh token) and the CLI sat in the agent's home,
and the tool ran as the agent's user.

On 14 Sep 2026, over Telegram, a local model (gpt-oss-120b) that had not read
the skill went looking for "the wallet address" on its own: `read_file` on
`config.json` (Hermes masked the access token; the refresh token went into
the model context whole), `read_file` on `signing-key.txt` (masked), then
`execute_code` to decode the `pbxk1.` token — the key's secret scalar landed
in the context and in `state.db`. Nothing was signed, so the approval gate
never fired: **the gate guards the signing run, not the key.** A stronger
model would probably not have done this. "Probably" is not a control.

## Decision

Two users and one sudo rule:

```
/opt/weavr-signer/            root-owned, world-readable, nothing writable by the agent
  bin/weavr-sign              the sudo target: re-checks the arguments, loads env, runs the tool
  tools/                      the wallet tool, its lib, and sign-proxy.mjs (+ @solana/web3.js)
  manifest.json               the weavr program allowlist
  env                         root:weavr-signer 0640 — PAYBOX_*, WEAVR_MANIFEST
/var/lib/weavr-signer/paybox  weavr-signer 0700 — config.json, signing-key.txt, the PayBox CLI, work/
/etc/sudoers.d/weavr-signer   <agent> ALL=(weavr-signer) NOPASSWD: /opt/weavr-signer/bin/weavr-sign, env_reset
```

The agent's `$WEAVR_SIGN_TOOL` is **`sign-proxy.mjs`**. It accepts exactly
seven shapes — `--address`, `--deployment <id>`, `--deposit <t> --amount <usd>`,
`--withdraw <t> --shares <n|all>`, `--propose <t> --mix BTC:60,SOL:40`,
`--apply <t>`, `--cancel <t>` — checks each value against a regex, then
`sudo -n -H -u weavr-signer weavr-sign …`, which checks the same shapes again,
sources its own env and execs the real tool. The tool's fallbacks (`--file`,
`--tx`, which print signed bytes) are not reachable from the agent. sudo
resets the environment, so nothing the agent exports reaches the tool.

The agent user must **not** be a sudoer (cloud images' default user is;
`signer/install.sh` warns). The rehearsal host runs the agent as `hermes`.

## Consequences

- An agent that reads files, runs code, or follows a poisoned tool result
  still cannot obtain the key or the OAuth token: it can only ask the signer
  to run one of seven commands, each of which the approval gate sees.
- Two places check arguments (proxy and `weavr-sign`); both are tested
  (`weavr/tests/sign_proxy.test.mjs`).
- Login and key minting happen as the signer; the agent never sees them.
- Rehearsal wallets still stay small: PayBox's grant is autonomous and has
  no spend limit yet; that limit is the next control, on PayBox's side.
