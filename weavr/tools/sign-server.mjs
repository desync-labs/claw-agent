#!/usr/bin/env node
/**
 * sign-server.mjs — the signer side of the two-container layout.
 *
 * Listens on a unix socket (WEAVR_SIGN_SOCKET, default /run/weavr/sign.sock)
 * for one request per connection: a JSON line {"argv":[...]}. The argv is
 * checked with the proxy's validate() (the seven shapes, canonical order),
 * then against the mode's allowlist, then the wallet tool runs with this
 * process's environment (PAYBOX_*, WEAVR_*) and its one-line JSON output goes
 * back as {"status":<exit code>,"stdout":"..."}.
 *
 * The agent container mounts only the socket; the keys, the PayBox config and
 * the credential id live here and never enter the agent's environment. One
 * request runs at a time (the tool is spawned synchronously).
 *
 * Modes (WEAVR_AGENT_MODE):
 *   client   --address --deployment --deposit --withdraw           (default)
 *   curator  client + --propose --apply --cancel
 */
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './sign-proxy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const MODES = {
  client: ['--address', '--deployment', '--deposit', '--withdraw'],
  curator: ['--address', '--deployment', '--deposit', '--withdraw', '--propose', '--apply', '--cancel'],
};

export function allowedInMode(mode, argv) {
  const verbs = MODES[mode];
  return Array.isArray(verbs) && verbs.includes(argv[0]);
}

/** One request: validate, check the mode, run the tool. Never throws. */
export function handle(argv, { mode = 'client', impl, env = process.env, nodeBin = process.execPath, timeoutMs = 300_000 } = {}) {
  if (!Array.isArray(argv) || !argv.every((a) => typeof a === 'string')) {
    return { status: 1, stdout: JSON.stringify({ error: 'USAGE', detail: 'argv must be a list of strings' }) + '\n' };
  }
  const v = validate(argv);
  if (!v.ok) return { status: 1, stdout: JSON.stringify({ error: 'USAGE', detail: v.detail }) + '\n' };
  if (!allowedInMode(mode, v.argv)) {
    return { status: 1, stdout: JSON.stringify({ error: 'MODE', detail: `${v.argv[0]} is not available in ${mode} mode` }) + '\n' };
  }
  const r = spawnSync(nodeBin, [impl, ...v.argv], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
  if (r.error || (r.status == null)) {
    const why = r.error ? r.error.message : 'the tool did not exit';
    return { status: 5, stdout: JSON.stringify({ error: 'CONFIG', detail: `cannot run the wallet tool: ${why.slice(0, 160)}` }) + '\n' };
  }
  if (!r.stdout) {
    const why = (r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`;
    return { status: r.status || 8, stdout: JSON.stringify({ error: 'FAILED', detail: why.slice(0, 200) }) + '\n' };
  }
  return { status: r.status, stdout: r.stdout };
}

export function serve({ socketPath, mode, impl, env = process.env, log = (m) => process.stderr.write(m + '\n') }) {
  if (existsSync(socketPath)) unlinkSync(socketPath);
  const server = createServer((conn) => {
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) { if (buf.length > 4096) conn.destroy(); return; }
      let req;
      try { req = JSON.parse(buf.slice(0, nl)); } catch { req = null; }
      const res = handle(req?.argv, { mode, impl, env });
      log(`${mode} ${JSON.stringify(req?.argv ?? null)} -> ${res.status}`);
      conn.end(JSON.stringify(res) + '\n');
    });
    conn.on('error', () => {});
  });
  server.on('error', (e) => { log(`cannot listen on ${socketPath}: ${e.code || e.message}`); process.exitCode = 1; });
  server.listen(socketPath, () => {
    chmodSync(socketPath, 0o660);
    log(`weavr signer listening on ${socketPath} (${mode} mode)`);
  });
  return server;
}

export function main(env = process.env) {
  const socketPath = env.WEAVR_SIGN_SOCKET || '/run/weavr/sign.sock';
  const mode = env.WEAVR_AGENT_MODE || 'client';
  if (!MODES[mode]) {
    process.stderr.write(`WEAVR_AGENT_MODE must be one of ${Object.keys(MODES).join(', ')}, got ${mode}\n`);
    process.exit(2);
  }
  const impl = env.WEAVR_SIGN_IMPL || join(HERE, 'sign-solana.mjs');
  const server = serve({ socketPath, mode, impl, env });
  const stop = () => { server.close(); try { unlinkSync(socketPath); } catch { /* gone */ } process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
