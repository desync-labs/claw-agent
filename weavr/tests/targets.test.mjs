// The curator's change of mix through the wallet tool: build_propose_targets
// with this wallet as curator → check → sign → send_signed, then the apply
// step in the same run when the notice period is short, or a pointer to
// --apply when it is not. A fake weavr client records the calls; the local
// dust signer signs; no network, no key, no money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const OPS_ROOT = fileURLToPath(new URL('..', import.meta.url));
import { allowedPrograms, programsFromManifest } from '../tools/lib/tx-checks.mjs';
import { localSigner } from '../tools/lib/local-signer.mjs';
import { applyTargets, cancelTargets, changeTargets, parseMix } from '../tools/lib/weavr.mjs';

const require = createRequire(import.meta.url);
const { Keypair, PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');

const FACTORY = new PublicKey('CB1Tw9aB8ju66q9ZVcezyfCbwNJDVLAMn2RpU3K1tVn');
const allowed = allowedPrograms(programsFromManifest(join(OPS_ROOT, 'manifest.json')));
const keypair = Keypair.generate();
const keypairFile = join(mkdtempSync(join(tmpdir(), 'targets-')), 'dust.json');
writeFileSync(keypairFile, JSON.stringify([...keypair.secretKey]));
const signer = localSigner({ keypairFile });

function tx(payer) {
  const t = new Transaction({ feePayer: payer, recentBlockhash: '11111111111111111111111111111111' });
  t.add(new TransactionInstruction({ programId: FACTORY, keys: [{ pubkey: payer, isSigner: true, isWritable: true }], data: Buffer.from([1]) }));
  return t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

/** A weavr client that answers each tool from a table and records the calls. */
function fakeClient(answers) {
  const calls = [];
  return {
    calls,
    async mcpCall(name, args) {
      calls.push([name, args]);
      const a = answers[name];
      return typeof a === 'function' ? a(args) : (a ?? { isError: true, payload: { error: 'UNKNOWN_TOOL' } });
    },
  };
}

const built = { isError: false, payload: { walletPayload: { transactions: [tx(keypair.publicKey)], signer: keypair.publicKey.toBase58() } } };
const sent = { isError: false, payload: { status: 'confirmed', signatures: ['sig'] } };

test('parseMix reads TICKER:PERCENT pairs and insists on 100', () => {
  assert.deepEqual(parseMix('BTC:60,SOL:40'), [{ ticker: 'BTC', percent: 60 }, { ticker: 'SOL', percent: 40 }]);
  for (const bad of ['BTC:60', 'BTC:60,SOL:50', 'BTC', 'BTC:x,SOL:100', '']) assert.throws(() => parseMix(bad), /USAGE|not TICKER|adds up/, bad);
});

test('a short notice period: propose, wait, apply — one run, two signatures', async () => {
  const client = fakeClient({ build_propose_targets: built, build_apply_targets: built, send_signed: sent, get_portfolio: { isError: false, payload: { rebalanceDelaySecs: 60 } } });
  const slept = [];
  const r = await changeTargets(client, 'CLAWR3', parseMix('BTC:50,SOL:50'), signer, allowed, { autoApplySecs: 120, sleep: async (ms) => { slept.push(ms); } });
  assert.equal(r.ok, true);
  assert.equal(r.output.status, 'applied');
  assert.equal(r.output.noticeSecs, 60);
  assert.deepEqual(slept, [62_000]);
  assert.deepEqual(client.calls.map(([n]) => n), ['build_propose_targets', 'send_signed', 'get_portfolio', 'build_apply_targets', 'send_signed']);
  assert.equal(client.calls[0][1].curator, keypair.publicKey.toBase58(), 'this wallet is the curator');
  assert.deepEqual(client.calls[0][1].mix, [{ ticker: 'BTC', percent: 50 }, { ticker: 'SOL', percent: 50 }]);
  assert.equal(client.calls[3][1].caller, keypair.publicKey.toBase58());
  assert.equal('walletPayload' in r.output, false, 'no transaction bytes in the output');
});

test('a long notice period: propose only, and say when --apply can run', async () => {
  const client = fakeClient({ build_propose_targets: built, send_signed: sent, get_portfolio: { isError: false, payload: { rebalanceDelaySecs: 86_400 } } });
  const r = await changeTargets(client, 'CLAWR3', parseMix('BTC:50,SOL:50'), signer, allowed, { sleep: async () => { throw new Error('must not wait'); } });
  assert.equal(r.ok, true);
  assert.equal(r.output.status, 'proposed');
  assert.match(r.output.next, /--apply CLAWR3 after 20/);
  assert.deepEqual(client.calls.map(([n]) => n), ['build_propose_targets', 'send_signed', 'get_portfolio']);
});

test('a refused build stops before anything is signed; apply and cancel name their signer', async () => {
  const client = fakeClient({ build_propose_targets: { isError: true, payload: { error: 'NOT_CURATOR', summary: 'this wallet is not the curator' } } });
  const r = await changeTargets(client, 'CLAWR3', parseMix('BTC:50,SOL:50'), signer, allowed);
  assert.equal(r.ok, false);
  assert.equal(r.exit, 7);
  assert.equal(r.output.error, 'NOT_CURATOR');
  assert.deepEqual(client.calls.map(([n]) => n), ['build_propose_targets']);

  const wrongPayer = { isError: false, payload: { walletPayload: { transactions: [tx(Keypair.generate().publicKey)] } } };
  const c2 = fakeClient({ build_apply_targets: wrongPayer });
  const a = await applyTargets(c2, 'CLAWR3', signer, allowed);
  assert.equal(a.ok, false);
  assert.equal(a.output.error, 'WRONG_PAYER');
  assert.deepEqual(c2.calls.map(([n]) => n), ['build_apply_targets'], 'nothing was sent');

  const c3 = fakeClient({ build_cancel_targets: built, send_signed: sent });
  const c = await cancelTargets(c3, 'CLAWR3', signer, allowed);
  assert.equal(c.ok, true);
  assert.equal(c.output.action, 'cancel_targets');
  assert.equal(c3.calls[0][1].signer, keypair.publicKey.toBase58());
});
