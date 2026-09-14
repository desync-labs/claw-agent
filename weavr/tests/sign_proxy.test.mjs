// The proxy is the agent's whole reach into the signer: three command shapes,
// checked before sudo is ever called, and checked again by weavr-sign on the
// other side. Each refusal is a planted case; the sudo hop runs against a
// fake sudo that records what it was asked to run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const OPS_ROOT = fileURLToPath(new URL('..', import.meta.url));
import { validate } from '../tools/sign-proxy.mjs';

const PROXY = join(OPS_ROOT, 'tools/sign-proxy.mjs');
const WEAVR_SIGN = join(OPS_ROOT, 'signer/weavr-sign');

test('validate accepts the three shapes and returns them in canonical order', () => {
  assert.deepEqual(validate(['--address']), { ok: true, argv: ['--address'] });
  assert.deepEqual(validate(['--deployment', '5ed63540-645e-4b1c']), { ok: true, argv: ['--deployment', '5ed63540-645e-4b1c'] });
  assert.deepEqual(validate(['--deposit', 'CLAWR3', '--amount', '5']), { ok: true, argv: ['--deposit', 'CLAWR3', '--amount', '5'] });
  assert.deepEqual(validate(['--amount', '0.5', '--deposit', 'clawr3']), { ok: true, argv: ['--deposit', 'clawr3', '--amount', '0.5'] });
});

test('validate refuses the fallbacks, extras, duplicates and odd values', () => {
  const refused = [
    [],
    ['--file', 'p.json', '--send'],
    ['--tx', 'AAAA'],
    ['--address', '--deployment', '5ed63540-645e'],
    ['--deployment'],
    ['--deployment', 'short'],
    ['--deployment', 'x;rm -rf /'],
    ['--deposit', 'CLAWR3'],
    ['--deposit', 'CLAWR3', '--amount', 'five'],
    ['--deposit', 'CLAWR3', '--amount', '0'],
    ['--deposit', 'CLAWR3', '--amount', '-5'],
    ['--deposit', 'CLAW R3', '--amount', '5'],
    ['--deposit', 'CLAWR3', '--amount', '5', '--amount', '6'],
    ['--deposit', 'CLAWR3', '--amount', '5', 'extra'],
    ['--help'],
  ];
  for (const argv of refused) assert.equal(validate(argv).ok, false, JSON.stringify(argv));
});

test('the proxy hands a valid command to sudo as the signer and refuses without calling it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sign-proxy-'));
  try {
    const record = join(dir, 'sudo.json');
    const fakeSudo = join(dir, 'sudo');
    writeFileSync(fakeSudo, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write('{"status":"confirmed"}\\n');\n`, { mode: 0o755 });
    const env = { ...process.env, WEAVR_SIGNER_SUDO: fakeSudo, WEAVR_SIGNER_USER: 'weavr-signer', WEAVR_SIGNER_BIN: '/opt/weavr-signer/bin/weavr-sign' };

    const ok = spawnSync(process.execPath, [PROXY, '--deposit', 'CLAWR3', '--amount', '5'], { env, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, '{"status":"confirmed"}\n');
    assert.deepEqual(JSON.parse(readFileSync(record, 'utf8')), ['-n', '-H', '-u', 'weavr-signer', '/opt/weavr-signer/bin/weavr-sign', '--deposit', 'CLAWR3', '--amount', '5']);

    rmSync(record);
    const no = spawnSync(process.execPath, [PROXY, '--file', 'p.json', '--send'], { env, encoding: 'utf8' });
    assert.equal(no.status, 1);
    assert.equal(JSON.parse(no.stdout).error, 'USAGE');
    assert.ok(!existsSync(record), 'sudo was not called for a refused command');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the proxy reports a missing sudo path as CONFIG, not as a signing failure', () => {
  const r = spawnSync(process.execPath, [PROXY, '--address'], { env: { ...process.env, WEAVR_SIGNER_SUDO: '/nonexistent/sudo' }, encoding: 'utf8' });
  assert.equal(r.status, 5);
  assert.equal(JSON.parse(r.stdout).error, 'CONFIG');
});

test('weavr-sign checks the arguments before anything else, then insists on its user', () => {
  const bad = spawnSync('bash', [WEAVR_SIGN, '--file', 'p.json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).error, 'USAGE');
  const wrongUser = spawnSync('bash', [WEAVR_SIGN, '--address'], { env: { ...process.env, WEAVR_SIGNER_USER: 'weavr-signer' }, encoding: 'utf8' });
  assert.equal(wrongUser.status, 5);
  assert.equal(JSON.parse(wrongUser.stdout).error, 'CONFIG');
});
