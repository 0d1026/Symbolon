import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NETWORK,
  SCHEME,
  WALLET,
  agentAccount,
  b64json,
  callWallet,
  fetchRetry,
  ownerRequest,
  parseInvoice,
  payArgs,
  sha256Hex,
  signedDecision,
  unb64json,
  type PaymentPayload,
  type PaymentRequired,
  type SettlementResponse,
} from "./lib.js";

export interface Purchase {
  status: number;
  proof: PaymentPayload | null;
  payTx: string | null;
  nonceTx: string | null;
  payValue: string | null;
  required: PaymentRequired | null;
}

export async function purchase(url: string, fetchData = true): Promise<Purchase> {
  const first = await fetchRetry(url);
  if (first.status !== 402) {
    console.log(`status ${first.status}, no payment needed`);
    console.log(await first.text());
    return { status: first.status, proof: null, payTx: null, nonceTx: null, payValue: null, required: null };
  }
  const header = first.headers.get("payment-required");
  if (!header) throw new Error("402 without PAYMENT-REQUIRED header");
  const required = unb64json<PaymentRequired>(header);
  const accepted = required.accepts.find((a) => a.scheme === SCHEME && a.network === NETWORK && a.extra?.paymentFlow === "upfront");
  if (!accepted) throw new Error(`no accepted payment option for ${SCHEME} on ${NETWORK}`);
  if (accepted.extra.symbolon.wallet !== WALLET) throw new Error(`merchant expects wallet ${accepted.extra.symbolon.wallet}`);

  const { invoice, invoiceSig } = accepted.extra.symbolon;
  const inv = parseInvoice(invoice);
  if (inv.payee !== accepted.payTo || inv.amount !== accepted.amount) throw new Error("invoice does not match the payment requirements");
  console.log(`402 from ${accepted.payTo}: ${inv.amount} base units, invoice ${inv.id}, memo "${inv.memo}"`);

  const account = agentAccount();
  const n = await callWallet(account, "request_nonce", { invoice_hash: sha256Hex(invoice) }, 30);
  if (!n.ok || !n.value) throw new Error(`request_nonce failed: ${n.failure}`);
  console.log(`request_nonce ${n.tx} nonce ${n.value}`);

  const d = await signedDecision(ownerRequest(n.value, invoice));
  console.log(`policy decision ${d.content} signed by ${d.signingAddress} (${d.signatureKind})`);

  const paid = await callWallet(account, "pay", payArgs(invoice, invoiceSig, d.responseBytes, d.signature), 100);
  console.log(`pay ${paid.tx} -> ${paid.value ?? paid.failure}`);
  if (paid.value !== "paid") {
    console.log("payment not made, stopping");
    return { status: 0, proof: null, payTx: paid.tx, nonceTx: n.tx, payValue: paid.value, required };
  }

  const proof: PaymentPayload = {
    x402Version: 2,
    resource: required.resource,
    accepted,
    payload: { transaction: paid.tx, payer: WALLET },
  };
  if (!fetchData) return { status: 0, proof, payTx: paid.tx, nonceTx: n.tx, payValue: paid.value, required };
  const second = await fetchRetry(url, { headers: { "PAYMENT-SIGNATURE": b64json(proof) } });
  const settlement = second.headers.get("payment-response");
  console.log(`status ${second.status}`);
  if (settlement) console.log(`settlement ${JSON.stringify(unb64json<SettlementResponse>(settlement))}`);
  console.log(await second.text());
  return { status: second.status, proof, payTx: paid.tx, nonceTx: n.tx, payValue: paid.value, required };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, url] = process.argv.slice(2);
  if (command !== "buy" || !url) {
    console.error("usage: npx tsx src/agent.ts buy <url>");
    process.exit(2);
  }
  purchase(url)
    .then((p) => {
      if (p.status !== 200) process.exitCode = 1;
    })
    .catch((e: Error) => {
      console.error(e.message);
      process.exit(1);
    });
}
