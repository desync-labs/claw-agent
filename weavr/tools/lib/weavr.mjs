/**
 * The weavr side of the wallet tool: MCP calls, the REST rebuild, and the
 * three flows an agent needs (finish a create, make a deposit, sign a payload).
 * A `signer` is `{ wallet, sign(encodedList) -> Promise<string[]> }`; the
 * checks run here, before any signer sees a transaction.
 */
import { readFileSync } from 'node:fs';
import { checkAll } from './tx-checks.mjs';

export const DEFAULT_MCP = 'https://api.weavr.sh/mcp';
export const DEFAULT_API = 'https://api.weavr.sh';

export function weavrClient({ mcpUrl = DEFAULT_MCP, apiUrl = DEFAULT_API, fetchImpl = fetch, headers = {} } = {}) {
  async function mcpCall(name, argumentsObj) {
    const res = await fetchImpl(mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: argumentsObj } }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`weavr ${name}: ${body.error.message ?? JSON.stringify(body.error)}`);
    const r = body.result;
    const payload = r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}');
    return { isError: Boolean(r.isError), payload };
  }
  async function rest(method, path, body) {
    const res = await fetchImpl(apiUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json };
  }
  return { mcpCall, rest };
}

/** Strip the one field that must never reach a transcript. */
export const scrub = (p) => { const { walletPayload, ...rest } = p ?? {}; return rest; };

function refusal(check) {
  return { ok: false, exit: check.exit, output: { error: check.error, detail: check.detail } };
}

/** Sign a list of encoded transactions after the checks. */
export async function signChecked(encodedList, signer, allowed) {
  const check = checkAll(encodedList, { wallet: signer.wallet, allowed });
  if (!check.ok) return refusal(check);
  const signed = await signer.sign(encodedList);
  return { ok: true, signed };
}

/** Sign what `create_portfolio` handed back and wait until the portfolio is live. */
export async function finishDeployment(client, deploymentId, signer, allowed, { awaitRounds = 6, timeoutSecs = 50 } = {}) {
  const rebuilt = await client.rest('POST', `/v1/deployments/${deploymentId}/rebuild`, {});
  if (rebuilt.status >= 400) return { ok: false, exit: 7, output: { step: 'rebuild', status: rebuilt.status, ...scrub(rebuilt.json) } };
  const record = rebuilt.json.deployment ?? rebuilt.json;
  const steps = (record.transactions ?? []).filter((s) => s.signer === 'creator' && s.tx);
  if (!steps.length) {
    return { ok: false, exit: 7, output: { step: 'rebuild', detail: 'no creator step to sign (already signed?)', status: record.status, waitingOn: record.waitingOn } };
  }
  const signedResult = await signChecked(steps.map((s) => s.tx), signer, allowed);
  if (!signedResult.ok) return signedResult;
  let last;
  for (let i = 0; i < awaitRounds; i += 1) {
    const args = i === 0 ? { deploymentId, signed: signedResult.signed, timeoutSecs } : { deploymentId, timeoutSecs };
    last = await client.mcpCall('await_portfolio', args);
    const st = last.payload?.status;
    if (last.isError || st === 'live' || st === 'sign_again') break;
  }
  return { ok: !last.isError, exit: last.isError ? 7 : 0, output: { step: 'await_portfolio', ...scrub(last.payload) } };
}

/** Build, sign and send a deposit. */
export async function makeDeposit(client, portfolio, amountUsd, signer, allowed) {
  const built = await client.mcpCall('build_deposit', { portfolio, user: signer.wallet, amountUsd });
  if (built.isError) return { ok: false, exit: 7, output: { step: 'build_deposit', ...scrub(built.payload) } };
  const txs = built.payload.walletPayload?.transactions ?? [];
  if (!txs.length) return { ok: false, exit: 7, output: { step: 'build_deposit', ...scrub(built.payload) } };
  const signedResult = await signChecked(txs, signer, allowed);
  if (!signedResult.ok) return signedResult;
  const sent = await client.mcpCall('send_signed', { signed: signedResult.signed });
  return { ok: !sent.isError, exit: sent.isError ? 7 : 0, output: { step: 'send_signed', portfolio, amountUsd, ...scrub(sent.payload) } };
}

/** `BTC:60,SOL:40` → [{ ticker, percent }], adding up to 100. */
export function parseMix(text) {
  const mix = String(text ?? '').split(',').filter(Boolean).map((part) => {
    const [ticker, pct] = part.split(':');
    const percent = Number(pct);
    if (!/^[A-Za-z0-9]{1,12}$/.test(ticker ?? '') || !(percent >= 0 && percent <= 100)) {
      const err = new Error(`mix entry "${part}" is not TICKER:PERCENT`); err.code = 'USAGE'; throw err;
    }
    return { ticker, percent };
  });
  const total = mix.reduce((s, m) => s + m.percent, 0);
  if (!mix.length || Math.abs(total - 100) > 0.01) {
    const err = new Error(`mix adds up to ${total}, not 100`); err.code = 'USAGE'; throw err;
  }
  return mix;
}

/** build → check → sign → send, for the one-transaction curator actions. */
async function buildSignSend(client, tool, args, signer, allowed, label) {
  const built = await client.mcpCall(tool, args);
  const txs = built.payload?.walletPayload?.transactions ?? [];
  if (built.isError || !txs.length) return { ok: false, exit: 7, output: { step: tool, ...scrub(built.payload) } };
  const signedResult = await signChecked(txs, signer, allowed);
  if (!signedResult.ok) return signedResult;
  const sent = await client.mcpCall('send_signed', { signed: signedResult.signed });
  return { ok: !sent.isError, exit: sent.isError ? 7 : 0, output: { step: 'send_signed', action: label, ...scrub(sent.payload) } };
}

/**
 * Propose a new mix as the curator (this wallet). The change takes effect
 * after the portfolio's notice period; when that period is short enough to
 * wait out in one run (`autoApplySecs`), the apply step is signed and sent
 * here too, so one approval covers the whole change. Otherwise the output
 * says when `--apply` can run.
 */
export async function changeTargets(client, portfolio, mix, signer, allowed, { autoApplySecs = 120, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const proposed = await buildSignSend(client, 'build_propose_targets', { portfolio, curator: signer.wallet, mix }, signer, allowed, 'propose_targets');
  if (!proposed.ok) return proposed;
  const info = await client.mcpCall('get_portfolio', { portfolio });
  const delaySecs = Number(info.payload?.rebalanceDelaySecs ?? NaN);
  const applyAt = Number.isFinite(delaySecs) ? new Date(Date.now() + delaySecs * 1000).toISOString() : undefined;
  const out = { ...proposed.output, portfolio, mix, noticeSecs: Number.isFinite(delaySecs) ? delaySecs : undefined, applyAt };
  if (!(Number.isFinite(delaySecs) && delaySecs <= autoApplySecs)) return { ok: true, exit: 0, output: { ...out, status: 'proposed', next: `run --apply ${portfolio} after ${applyAt ?? 'the notice period'}` } };
  await sleep((delaySecs + 2) * 1000);
  const applied = await applyTargets(client, portfolio, signer, allowed);
  if (!applied.ok) return { ok: false, exit: applied.exit, output: { ...out, status: 'proposed', apply: applied.output, next: `run --apply ${portfolio} once more` } };
  return { ok: true, exit: 0, output: { ...out, status: 'applied', apply: applied.output } };
}

/** Apply a proposal whose notice period has passed (anyone may sign it; this wallet does). */
export async function applyTargets(client, portfolio, signer, allowed) {
  return buildSignSend(client, 'build_apply_targets', { portfolio, caller: signer.wallet }, signer, allowed, 'apply_targets');
}

/** Cancel a pending proposal as the curator. */
export async function cancelTargets(client, portfolio, signer, allowed) {
  return buildSignSend(client, 'build_cancel_targets', { portfolio, signer: signer.wallet }, signer, allowed, 'cancel_targets');
}

/**
 * This wallet's shares of a portfolio, from the chain: `{ mint, amount (base
 * units, string), decimals, shares (ui) }`. `rpc` defaults to the public
 * mainnet endpoint (WEAVR_RPC_URL overrides).
 */
export async function shareBalance(client, portfolio, wallet, { rpcUrl = process.env.WEAVR_RPC_URL || 'https://api.mainnet-beta.solana.com', fetchImpl = fetch } = {}) {
  const info = await client.mcpCall('get_portfolio', { portfolio });
  const mint = info.payload?.mint;
  if (info.isError || !mint) { const err = new Error(`portfolio ${portfolio} not found`); err.code = 'WEAVR_ERROR'; throw err; }
  const res = await fetchImpl(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [wallet, { mint }, { encoding: 'jsonParsed' }] }),
  });
  const body = await res.json();
  let amount = 0n; let decimals = 0;
  for (const acc of body.result?.value ?? []) {
    const t = acc.account?.data?.parsed?.info?.tokenAmount;
    if (t) { amount += BigInt(t.amount); decimals = Number(t.decimals); }
  }
  return { mint, amount: amount.toString(), decimals, shares: Number(amount) / 10 ** decimals };
}

/**
 * Queue a withdrawal of `shares` (a number of shares, or "all") as this
 * wallet. weavr pays requests in order as funds free up; the output carries
 * the request id to follow with get_withdrawal.
 */
export async function requestWithdraw(client, portfolio, sharesArg, signer, allowed, opts = {}) {
  const held = await shareBalance(client, portfolio, signer.wallet, opts);
  let base;
  if (String(sharesArg).toLowerCase() === 'all') base = BigInt(held.amount);
  else {
    const n = Number(sharesArg);
    if (!(n > 0)) { const err = new Error('shares must be a positive number or "all"'); err.code = 'USAGE'; throw err; }
    base = BigInt(Math.round(n * 10 ** held.decimals));
  }
  if (base <= 0n || base > BigInt(held.amount)) {
    return { ok: false, exit: 7, output: { error: 'INSUFFICIENT_SHARES', detail: `this wallet holds ${held.shares} shares of ${portfolio}`, portfolio, shares: held.shares } };
  }
  const r = await buildSignSend(client, 'build_withdraw', { portfolio, user: signer.wallet, shares: base.toString() }, signer, allowed, 'withdraw');
  return { ...r, output: { ...r.output, portfolio, shares: Number(base) / 10 ** held.decimals, sharesHeldBefore: held.shares } };
}

/** Read the transactions out of a saved walletPayload (or a bare list). */
export function transactionsFromFile(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const list = json.walletPayload?.transactions ?? json.transactions ?? (Array.isArray(json) ? json : null);
  if (!Array.isArray(list) || !list.length) throw new Error(`${path}: no transactions found`);
  return list;
}
