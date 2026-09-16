#!/usr/bin/env node
/**
 * sign-proxy.mjs — what the agent's $WEAVR_SIGN_TOOL points at once the keys
 * live with the weavr-signer user (../signer/install.sh) or, in the container
 * layout, in the signer container (WEAVR_SIGN_SOCKET set: sign-server.mjs).
 *
 * Same commands and the same one-line JSON output as sign-solana.mjs, minus
 * the fallbacks: the agent may ask for the address, finish a create or make a
 * deposit, nothing else.
 *
 *   --address
 *   --deployment <deploymentId>
 *   --deposit <ticker> --amount <usd>
 *   --propose <ticker> --mix BTC:60,SOL:40     (the curator's change of mix; applied in the same run
 *                                              when the notice period is short, else --apply later)
 *   --apply <ticker>
 *   --cancel <ticker>
 *
 * The arguments are checked here, then again in signer/weavr-sign, and the
 * real tool runs as weavr-signer through sudo with a reset environment. No
 * process of the agent's user holds a key, a token or the PayBox config, so
 * an agent that reads files, runs code or takes orders from a poisoned tool
 * result still cannot sign on its own (14 Sep 2026: the model read
 * config.json and decoded the signing key with execute_code — the gate never
 * saw it, because nothing was signed).
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

export const SIGNER_USER = process.env.WEAVR_SIGNER_USER || 'weavr-signer';
export const SIGNER_BIN = process.env.WEAVR_SIGNER_BIN || '/opt/weavr-signer/bin/weavr-sign';
const SUDO = process.env.WEAVR_SIGNER_SUDO || 'sudo';

const DEPLOYMENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const TICKER = /^[A-Za-z0-9]{1,12}$/;
const AMOUNT_USD = /^[0-9]{1,9}(\.[0-9]{1,6})?$/;
const MIX = /^[A-Za-z0-9]{1,12}:[0-9]{1,3}(\.[0-9]{1,2})?(,[A-Za-z0-9]{1,12}:[0-9]{1,3}(\.[0-9]{1,2})?){0,31}$/;
const SHARES = /^(all|[0-9]{1,12}(\.[0-9]{1,9})?)$/i;

/**
 * The one command line the agent asked for, in canonical order, or a refusal.
 * Every flag at most once, no flag the signer does not know, values that are
 * a deployment id, a ticker or a USD amount and nothing else.
 */
export function validate(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) return { ok: false, detail: `unexpected argument ${a}` };
    if (flags.has(a)) return { ok: false, detail: `${a} given twice` };
    if (a === '--address') { flags.set(a, true); continue; }
    if (['--deployment', '--deposit', '--amount', '--withdraw', '--shares', '--propose', '--mix', '--apply', '--cancel'].includes(a)) {
      const v = argv[i + 1];
      if (v == null || v.startsWith('--')) return { ok: false, detail: `${a} needs a value` };
      flags.set(a, v); i++; continue;
    }
    return { ok: false, detail: `${a} is not available through the proxy` };
  }
  const keys = [...flags.keys()].sort().join(' ');
  if (keys === '--address') return { ok: true, argv: ['--address'] };
  if (keys === '--deployment') {
    const id = flags.get('--deployment');
    return DEPLOYMENT_ID.test(id) ? { ok: true, argv: ['--deployment', id] } : { ok: false, detail: 'deployment id has an unexpected shape' };
  }
  if (keys === '--amount --deposit') {
    const ticker = flags.get('--deposit'); const amount = flags.get('--amount');
    if (!TICKER.test(ticker)) return { ok: false, detail: 'ticker has an unexpected shape' };
    if (!AMOUNT_USD.test(amount) || !(Number(amount) > 0)) return { ok: false, detail: 'amount must be a positive USD number' };
    return { ok: true, argv: ['--deposit', ticker, '--amount', amount] };
  }
  if (keys === '--shares --withdraw') {
    const ticker = flags.get('--withdraw'); const shares = flags.get('--shares');
    if (!TICKER.test(ticker)) return { ok: false, detail: 'ticker has an unexpected shape' };
    if (!SHARES.test(shares) || (shares.toLowerCase() !== 'all' && !(Number(shares) > 0))) return { ok: false, detail: 'shares must be a positive number or all' };
    return { ok: true, argv: ['--withdraw', ticker, '--shares', shares.toLowerCase()] };
  }
  if (keys === '--mix --propose') {
    const ticker = flags.get('--propose'); const mix = flags.get('--mix');
    if (!TICKER.test(ticker)) return { ok: false, detail: 'ticker has an unexpected shape' };
    if (!MIX.test(mix)) return { ok: false, detail: 'mix must be TICKER:PERCENT pairs separated by commas, e.g. BTC:60,SOL:40' };
    return { ok: true, argv: ['--propose', ticker, '--mix', mix] };
  }
  if (keys === '--apply' || keys === '--cancel') {
    const ticker = flags.get(keys);
    return TICKER.test(ticker) ? { ok: true, argv: [keys, ticker] } : { ok: false, detail: 'ticker has an unexpected shape' };
  }
  return { ok: false, detail: '--address | --deployment <id> | --deposit <ticker> --amount <usd> | --withdraw <ticker> --shares <n|all> | --propose <ticker> --mix <mix> | --apply <ticker> | --cancel <ticker>' };
}

function out(obj, code) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(code);
}

/**
 * The container layout: no sudo, the signer is another container that shares
 * one unix socket with this one (WEAVR_SIGN_SOCKET). One JSON line each way.
 */
export function viaSocket(socketPath, argv) {
  const conn = connect(socketPath);
  let buf = '';
  conn.setEncoding('utf8');
  conn.on('error', (e) => out({ error: 'CONFIG', detail: `signer not reachable at ${socketPath}: ${e.code || e.message}` }, 5));
  conn.on('connect', () => conn.write(JSON.stringify({ argv }) + '\n'));
  conn.on('data', (c) => { buf += c; });
  conn.on('end', () => {
    let res;
    try { res = JSON.parse(buf); } catch { return out({ error: 'CONFIG', detail: 'unreadable answer from the signer' }, 5); }
    process.stdout.write(res.stdout ?? '');
    process.exit(Number.isInteger(res.status) ? res.status : 8);
  });
}

export function main(argv = process.argv.slice(2)) {
  const v = validate(argv);
  if (!v.ok) return out({ error: 'USAGE', detail: v.detail }, 1);
  if (process.env.WEAVR_SIGN_SOCKET) return viaSocket(process.env.WEAVR_SIGN_SOCKET, v.argv);
  const r = spawnSync(SUDO, ['-n', '-H', '-u', SIGNER_USER, SIGNER_BIN, ...v.argv], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.error || (r.status !== 0 && !r.stdout)) {
    const why = r.error ? r.error.message : (r.stderr || '').trim().split('\n').pop() || `sudo exited ${r.status}`;
    return out({ error: 'CONFIG', detail: `cannot run ${SIGNER_BIN} as ${SIGNER_USER}: ${why.slice(0, 160)}` }, 5);
  }
  process.stdout.write(r.stdout);
  process.exit(r.status ?? 8);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
