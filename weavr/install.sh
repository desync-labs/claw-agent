#!/usr/bin/env bash
# install.sh — the weavr agent on one Ubuntu box, from this checkout, as root.
#
#   sudo weavr/install.sh [--agent-user hermes] [--telegram-token-file F --telegram-user 123456]
#                         [--paybox-from DIR --credential-id ID]
#
# What it sets up (the ADRs in docs/adr/weavr say why):
#   <agent user>   a plain user with no sudo: the Hermes venv from this checkout,
#                  $HOME/.hermes with config.yaml, the weavr skill, the gate plugin,
#                  the host brief AGENTS.md; config.yaml, .env and AGENTS.md immutable
#   weavr-signer   the PayBox keys, the wallet tool and the one sudo rule (signer/install.sh)
#   systemd        `hermes gateway install` for the agent user, with linger, so the
#                  Telegram gateway survives logouts and reboots (weavr/agentctl drives it)
#
# Idempotent: rerun after a pull to refresh the code and the tool; keys and
# state are kept. Ubuntu 22.04/24.04; Node >= 20 and Python 3.12 are installed
# if missing.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
AGENT=hermes
TELEGRAM_TOKEN_FILE=
TELEGRAM_USER=
PAYBOX_FROM=
CREDENTIAL_ID=
SKILL_URL=${WEAVR_SKILL_URL:-https://api.weavr.sh/hosts/hermes/SKILL.md}

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-user) AGENT=$2; shift 2 ;;
    --telegram-token-file) TELEGRAM_TOKEN_FILE=$2; shift 2 ;;
    --telegram-user) TELEGRAM_USER=$2; shift 2 ;;
    --paybox-from) PAYBOX_FROM=$2; shift 2 ;;
    --credential-id) CREDENTIAL_ID=$2; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[[ $(id -u) -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 2; }

step() { printf '\n== %s\n' "$*"; }

step "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git build-essential python3.12-venv python3-dev curl ca-certificates jq rsync e2fsprogs >/dev/null
if ! command -v node >/dev/null || [[ $(node -e 'process.stdout.write(process.versions.node.split(".")[0])') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
/usr/bin/python3.12 --version >/dev/null

step "agent user $AGENT (no sudo)"
id "$AGENT" >/dev/null 2>&1 || useradd -m -s /bin/bash "$AGENT"
if sudo -l -U "$AGENT" 2>/dev/null | grep -qE '\(ALL(\s*:\s*ALL)?\)'; then
  echo "WARNING: $AGENT has broad sudo rights; the key isolation is cosmetic until that is removed" >&2
fi
AGENT_HOME=$(getent passwd "$AGENT" | cut -d: -f6)
H=$AGENT_HOME/.hermes

step "the fork, as $AGENT, with its venv"
rsync -a --delete --exclude .venv --exclude weavr/node_modules "$REPO/" "$AGENT_HOME/claw-agent/"
chown -R "$AGENT:$AGENT" "$AGENT_HOME/claw-agent"
sudo -u "$AGENT" -H bash -c "cd ~/claw-agent && [[ -x .venv/bin/python ]] || /usr/bin/python3.12 -m venv .venv"
sudo -u "$AGENT" -H bash -c "cd ~/claw-agent && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -e '.[mcp,messaging]'"
sudo -u "$AGENT" -H bash -c "cd ~/claw-agent && .venv/bin/python weavr/patches/test_trust_gate.py"
sudo -u "$AGENT" -H bash -c 'grep -q "claw-agent/.venv/bin" ~/.profile 2>/dev/null || printf "\nexport PATH=\$HOME/claw-agent/.venv/bin:\$PATH\n" >> ~/.profile'

step "HERMES_HOME $H"
install -d -m 700 -o "$AGENT" -g "$AGENT" "$H" "$H/plugins" "$H/memories"
chattr -i "$H/config.yaml" "$H/.env" 2>/dev/null || true
install -o root -g "$AGENT" -m 640 "$HERE/config.yaml" "$H/config.yaml"
# the skill, from the API; the plugin; the bundled skills pruned to weavr
install -d -m 755 -o root -g root "$H/skills/weavr"
curl -fsS "$SKILL_URL" -o "$H/skills/weavr/SKILL.md"
chmod 644 "$H/skills/weavr/SKILL.md"
rm -rf "$H/plugins/weavr-wallet-gate"
cp -r "$HERE/plugins/weavr-wallet-gate" "$H/plugins/"
chown -R "$AGENT:$AGENT" "$H/plugins"
sudo -u "$AGENT" -H bash -c "cd ~ && ~/claw-agent/.venv/bin/hermes plugins enable weavr-wallet-gate </dev/null >/dev/null 2>&1 || true"
chown -R root:root "$H/skills"; chmod -R u=rwX,go=rX "$H/skills"
find "$H/skills" -mindepth 1 -maxdepth 1 ! -name weavr -exec rm -rf {} +
# the model's memory file: empty and frozen (ADR-0006)
: > "$H/memories/MEMORY.md"; chown root:"$AGENT" "$H/memories/MEMORY.md"; chmod 640 "$H/memories/MEMORY.md"
# the host brief, in the agent's cwd
chattr -i "$AGENT_HOME/AGENTS.md" 2>/dev/null || true
install -o root -g root -m 644 "$HERE/AGENTS.md" "$AGENT_HOME/AGENTS.md"
chattr +i "$AGENT_HOME/AGENTS.md"

step "the signer (keys under weavr-signer)"
args=(--agent-user "$AGENT")
[[ -n $PAYBOX_FROM ]] && args+=(--paybox-from "$PAYBOX_FROM")
[[ -n $CREDENTIAL_ID ]] && args+=(--credential-id "$CREDENTIAL_ID")
"$HERE/signer/install.sh" "${args[@]}" | sed -n '1,3p' || true

step ".env (agent side: the proxy and Telegram only)"
umask 027
{
  echo "WEAVR_SIGN_TOOL=/opt/weavr-signer/tools/sign-proxy.mjs"
  if [[ -n $TELEGRAM_TOKEN_FILE ]]; then echo "TELEGRAM_BOT_TOKEN=$(tr -d '[:space:]' < "$TELEGRAM_TOKEN_FILE")"; fi
  if [[ -n $TELEGRAM_USER ]]; then echo "TELEGRAM_ALLOWED_USERS=$TELEGRAM_USER"; fi
} > "$H/.env"
chown root:"$AGENT" "$H/.env"; chmod 640 "$H/.env"
chattr +i "$H/config.yaml" "$H/.env"

step "gateway as a systemd user service (linger on)"
loginctl enable-linger "$AGENT" >/dev/null 2>&1 || true
install -m 755 "$HERE/agentctl" /usr/local/bin/weavr-agentctl
sed -i "s|^AGENT=.*|AGENT=$AGENT|" /usr/local/bin/weavr-agentctl

cat <<EOT

Installed. Proofs (as $AGENT):
  sudo -u $AGENT -H bash -lc 'node \$WEAVR_SIGN_TOOL --address'          # {"address":…} once PayBox is set up
  sudo -u $AGENT -H bash -lc 'cat /opt/weavr-signer/env'                 # permission denied
  sudo -u $AGENT -H bash -lc 'hermes mcp test weavr'                     # Connected, 12 tools
  sudo -u $AGENT -H bash -lc 'hermes chat -Q -q "Deposit 1 dollar into CLAWR3."'   # ends in BLOCKED (no human in -q)

PayBox (once, as the signer — see signer/install.sh output above), then:
  weavr-agentctl start | status | logs | stop
EOT
