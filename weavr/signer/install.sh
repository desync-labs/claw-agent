#!/usr/bin/env bash
# install.sh — put the weavr wallet tool and the PayBox keys under their own
# system user, out of the agent's reach. Run as root on the agent's box:
#
#   sudo integrations/claw-agent/signer/install.sh \
#        --agent-user ubuntu \
#        --paybox-from /home/ubuntu/.config/weavr/demo/paybox-cli \
#        --credential-id <PayBox wallet credential id>
#
# Idempotent: rerun after a tools/ change to refresh /opt/weavr-signer; the
# keys under /var/lib/weavr-signer are kept. Afterwards the agent's .env
# carries WEAVR_SIGN_TOOL=/opt/weavr-signer/tools/sign-proxy.mjs and no
# PAYBOX_* variable at all (runbooks/CLAW_AGENT.md, "Key isolation").
#
# Layout:
#   /opt/weavr-signer/            root-owned, world-readable, nothing writable by the agent
#     bin/weavr-sign              the sudo target (this directory's weavr-sign)
#     tools/                      copy of integrations/claw-agent/tools (sign-solana.mjs, lib/, sign-proxy.mjs)
#     node_modules/@solana/web3.js
#     manifest.json               the program allowlist
#     env                         root:weavr-signer 0640 — PAYBOX_* and WEAVR_* for the tool
#   /var/lib/weavr-signer/paybox  weavr-signer 0700 — config.json, signing-key.txt, tools/ (the PayBox CLI), work/
#   /etc/sudoers.d/weavr-signer   <agent user> may run bin/weavr-sign as weavr-signer, nothing else
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# the allowlist: next to the layer (the public fork, weavr/manifest.json) or at the ops root
if [[ -f $HERE/../manifest.json ]]; then OPS_ROOT=$(cd "$HERE/.." && pwd); else OPS_ROOT=$(cd "$HERE/../../.." && pwd); fi
SIGNER_USER=weavr-signer
ROOT=/opt/weavr-signer
STATE=/var/lib/weavr-signer
PAYBOX_DIR=$STATE/paybox
AGENT_USER=${SUDO_USER:-}
PAYBOX_FROM=
CREDENTIAL_ID=
WEB3_VERSION=1.98.4
PAYBOX_SDK_VERSION=0.8.5

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-user) AGENT_USER=$2; shift 2 ;;
    --paybox-from) PAYBOX_FROM=$2; shift 2 ;;
    --credential-id) CREDENTIAL_ID=$2; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[[ $(id -u) -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 2; }
[[ -n $AGENT_USER ]] || { echo "--agent-user <user> is required (the user Hermes runs as)" >&2; exit 2; }
id "$AGENT_USER" >/dev/null 2>&1 || { echo "no such user: $AGENT_USER" >&2; exit 2; }
# a sudoer agent user makes the split cosmetic: it can become weavr-signer (or
# root) through any other rule. Cloud images give their default user exactly that.
if sudo -l -U "$AGENT_USER" 2>/dev/null | grep -qE '\(ALL(\s*:\s*ALL)?\)'; then
  echo "WARNING: $AGENT_USER already has broad sudo rights (sudo -l -U $AGENT_USER); run the agent as a user with none" >&2
fi
[[ -x /usr/bin/node ]] || { echo "/usr/bin/node is missing (Node >= 20)" >&2; exit 2; }
[[ -f $OPS_ROOT/manifest.json ]] || { echo "manifest.json not found at $OPS_ROOT" >&2; exit 2; }

# 1. the user: no login, no home to speak of
if ! id "$SIGNER_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$STATE" --shell /usr/sbin/nologin "$SIGNER_USER"
fi
install -d -m 750 -o "$SIGNER_USER" -g "$SIGNER_USER" "$STATE"

# 2. the code: a root-owned copy the agent can read but never edit
install -d -m 755 "$ROOT" "$ROOT/bin"
rm -rf "$ROOT/tools"
cp -r "$HERE/../tools" "$ROOT/tools"
install -m 755 "$HERE/weavr-sign" "$ROOT/bin/weavr-sign"
install -m 644 "$OPS_ROOT/manifest.json" "$ROOT/manifest.json"
if [[ ! -d $ROOT/node_modules/@solana/web3.js ]]; then
  (cd "$ROOT" && npm install --no-audit --no-fund --silent --no-package-lock "@solana/web3.js@$WEB3_VERSION")
fi
chown -R root:root "$ROOT"
chmod -R u=rwX,go=rX "$ROOT"

# 3. the keys: moved from the agent's home (or an empty dir for a fresh login)
install -d -m 700 -o "$SIGNER_USER" -g "$SIGNER_USER" "$PAYBOX_DIR"
if [[ -n $PAYBOX_FROM ]]; then
  [[ -d $PAYBOX_FROM ]] || { echo "$PAYBOX_FROM is not a directory" >&2; exit 2; }
  for f in config.json signing-key.txt; do
    [[ -f $PAYBOX_FROM/$f ]] && mv -f "$PAYBOX_FROM/$f" "$PAYBOX_DIR/$f"
  done
  [[ -d $PAYBOX_FROM/tools ]] && { rm -rf "$PAYBOX_DIR/tools"; mv "$PAYBOX_FROM/tools" "$PAYBOX_DIR/tools"; }
  rm -rf "$PAYBOX_FROM/work" "$PAYBOX_FROM/lock"
  rmdir "$PAYBOX_FROM" 2>/dev/null || echo "note: $PAYBOX_FROM still holds files; check and remove it by hand" >&2
fi
if [[ ! -f $PAYBOX_DIR/tools/node_modules/@paybox-sh/sdk/dist/cli.js ]]; then
  install -d -m 700 -o "$SIGNER_USER" -g "$SIGNER_USER" "$PAYBOX_DIR/tools"
  sudo -u "$SIGNER_USER" -H npm install --prefix "$PAYBOX_DIR/tools" --no-audit --no-fund --silent "@paybox-sh/sdk@$PAYBOX_SDK_VERSION"
fi
# the CLI's own JS must not be writable by anyone but the signer either
chown -R "$SIGNER_USER:$SIGNER_USER" "$PAYBOX_DIR"
chmod 700 "$PAYBOX_DIR"
find "$PAYBOX_DIR" -maxdepth 1 -type f -exec chmod 600 {} +
[[ -f $PAYBOX_DIR/tools/deposit_address.js ]] && rm -f "$PAYBOX_DIR/tools/deposit_address.js"   # 14 Sep leftover

# 4. the signer's environment (never in the agent's .env)
PAYBOX_CLI=$PAYBOX_DIR/tools/node_modules/@paybox-sh/sdk/dist/cli.js
if [[ -z $CREDENTIAL_ID && -f $ROOT/env ]]; then
  CREDENTIAL_ID=$(sed -n 's/^PAYBOX_CREDENTIAL_ID=//p' "$ROOT/env")
fi
umask 027
cat > "$ROOT/env" <<EOT
# weavr-signer environment, loaded by bin/weavr-sign. Not the agent's file.
PAYBOX_CONFIG_DIR=$PAYBOX_DIR
PAYBOX_CREDENTIAL_ID=${CREDENTIAL_ID}
PAYBOX_CLI=$PAYBOX_CLI
WEAVR_MANIFEST=$ROOT/manifest.json
EOT
chown "root:$SIGNER_USER" "$ROOT/env"
chmod 640 "$ROOT/env"

# 5. sudo: one command, one target user, no password, a reset environment
cat > /etc/sudoers.d/weavr-signer <<EOT
# written by integrations/claw-agent/signer/install.sh
Defaults!$ROOT/bin/weavr-sign env_reset, !env_keep
$AGENT_USER ALL=($SIGNER_USER) NOPASSWD: $ROOT/bin/weavr-sign
EOT
chmod 440 /etc/sudoers.d/weavr-signer
visudo -cf /etc/sudoers.d/weavr-signer >/dev/null

# 6. prove it from the agent's side: the address is the only key-free read
echo "installed. As $AGENT_USER:"
if sudo -u "$AGENT_USER" -H /usr/bin/node "$ROOT/tools/sign-proxy.mjs" --address; then :; else
  echo "  (the address call failed — log in first, see below)" >&2
fi
cat <<EOT

Next:
  - set in the agent's \$HERMES_HOME/.env:  WEAVR_SIGN_TOOL=$ROOT/tools/sign-proxy.mjs
    and remove every PAYBOX_* line from it
  - PayBox login / key (as the signer, keys never touch the agent's user):
      sudo -u $SIGNER_USER -H env PAYBOX_CONFIG_DIR=$PAYBOX_DIR /usr/bin/node $PAYBOX_CLI login --no-provision
      sudo -u $SIGNER_USER -H sh -c 'umask 077; read -rsp "pbxk1 key: " K; echo; printf "%s\n" "\$K" > $PAYBOX_DIR/signing-key.txt'
      sudo -u $SIGNER_USER -H env PAYBOX_CONFIG_DIR=$PAYBOX_DIR /usr/bin/node $PAYBOX_CLI --json credentials   # then rerun with --credential-id
  - pre-flight (signs a memo that can never land):
      sudo -u $SIGNER_USER -H sh -c 'set -a; . $ROOT/env; /usr/bin/node $ROOT/tools/sign-check.mjs'
EOT
