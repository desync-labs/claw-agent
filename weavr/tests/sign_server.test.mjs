// The container layout's signer: one socket, one JSON line each way. The
// tool is a stub that echoes its argv, so the test proves the transport, the
// validation and the mode allowlist without a key or the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES, allowedInMode, handle, serve } from '../tools/sign-server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROXY = join(ROOT, 'tools/sign-proxy.mjs');

// a short path: unix socket paths are capped at ~104 bytes on macOS
const dir = mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'ws-'));
const STUB = join(dir, 'stub-tool.mjs');
writeFileSync(STUB, `process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cred: process.env.PAYBOX_CREDENTIAL_ID ?? null }) + '\\n'); process.exit(process.argv.includes('--withdraw') ? 3 : 0);\n`);
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('modes: client is create/deposit/withdraw, curator adds the mix commands', () => {
  assert.deepEqual(MODES.client, ['--address', '--deployment', '--deposit', '--withdraw']);
  assert.ok(MODES.curator.includes('--propose') && MODES.curator.includes('--apply') && MODES.curator.includes('--cancel'));
  assert.equal(allowedInMode('client', ['--propose', 'X', '--mix', 'BTC:60,SOL:40']), false);
  assert.equal(allowedInMode('curator', ['--propose', 'X', '--mix', 'BTC:60,SOL:40']), true);
  assert.equal(allowedInMode('nope', ['--address']), false);
});

test('handle validates, applies the mode and runs the tool with the signer environment only', () => {
  const env = { ...process.env, PAYBOX_CREDENTIAL_ID: 'cred-1' };
  const ok = handle(['--amount', '5', '--deposit', 'clawr3'], { mode: 'client', impl: STUB, env });
  assert.equal(ok.status, 0);
  assert.deepEqual(JSON.parse(ok.stdout), { argv: ['--deposit', 'clawr3', '--amount', '5'], cred: 'cred-1' });

  const exit = handle(['--withdraw', 'CLAWR3', '--shares', 'all'], { mode: 'client', impl: STUB, env });
  assert.equal(exit.status, 3, 'the tool exit code is passed through');

  const mode = handle(['--propose', 'CLAWR3', '--mix', 'BTC:60,SOL:40'], { mode: 'client', impl: STUB, env });
  assert.equal(mode.status, 1);
  assert.equal(JSON.parse(mode.stdout).error, 'MODE');

  const usage = handle(['--file', '/etc/passwd'], { mode: 'curator', impl: STUB, env });
  assert.equal(JSON.parse(usage.stdout).error, 'USAGE');
  assert.equal(JSON.parse(handle('nope', { mode: 'client', impl: STUB, env }).stdout).error, 'USAGE');
});

test('the proxy reaches the server over the socket and relays stdout and the exit code', async () => {
  const socketPath = join(dir, 'sign.sock');
  const logs = [];
  const server = serve({ socketPath, mode: 'curator', impl: STUB, env: { ...process.env, PAYBOX_CREDENTIAL_ID: 'cred-2' }, log: (m) => logs.push(m) });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const env = { ...process.env, WEAVR_SIGN_SOCKET: socketPath };
    const r = spawnSync(process.execPath, [PROXY, '--propose', 'CLAWR3', '--mix', 'BTC:60,SOL:40'], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { argv: ['--propose', 'CLAWR3', '--mix', 'BTC:60,SOL:40'], cred: 'cred-2' });

    const w = spawnSync(process.execPath, [PROXY, '--withdraw', 'CLAWR3', '--shares', '2'], { env, encoding: 'utf8' });
    assert.equal(w.status, 3);

    const bad = spawnSync(process.execPath, [PROXY, '--address', '--deposit', 'X', '--amount', '1'], { env, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).error, 'USAGE', 'refused on the agent side, never sent');
    assert.ok(logs.some((l) => l.includes('--propose')) && !logs.some((l) => l.includes('--address')));
  } finally {
    server.close();
  }
});

test('the proxy reports a missing signer as CONFIG', () => {
  const r = spawnSync(process.execPath, [PROXY, '--address'], { env: { ...process.env, WEAVR_SIGN_SOCKET: join(dir, 'absent.sock') }, encoding: 'utf8' });
  assert.equal(r.status, 5);
  assert.equal(JSON.parse(r.stdout).error, 'CONFIG');
});
