import { createPublicKey, verify } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  MERCHANT,
  NETWORK,
  SCHEME,
  USDC,
  WALLET,
  b64json,
  invoiceSigner,
  makeInvoice,
  parseInvoice,
  txOutcome,
  unb64json,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettlementResponse,
} from "./lib.js";

const PORT = Number(process.env.PORT ?? 4020);
const PRICE = process.env.PRICE_BASE_UNITS ?? "2000000";
const MEMO = "market data feed";
const PATH = "/data/market-feed";

const INVOICE_TTL_SECONDS = 600;
const PROOF_GRACE_SECONDS = 24 * 60 * 60;

const invoiceKey = invoiceSigner("merchant-invoice-testnet.json");
const invoicePublicKey = createPublicKey(invoiceKey);
const SERVED_FILE = process.env.SERVED_FILE ?? join(homedir(), ".symbolon", "merchant-served.txt");
const served = new Set<string>(existsSync(SERVED_FILE) ? readFileSync(SERVED_FILE, "utf8").split("\n").filter(Boolean) : []);
const verifying = new Set<string>();

function markServed(id: string): void {
  appendFileSync(SERVED_FILE, `${id}\n`, { mode: 0o600 });
  served.add(id);
}

function resourceOf(req: IncomingMessage): PaymentRequired["resource"] {
  return {
    url: `http://${req.headers.host ?? `localhost:${PORT}`}${PATH}`,
    description: "Market data feed snapshot",
    mimeType: "application/json",
  };
}

function paymentRequired(req: IncomingMessage, res: ServerResponse, error: string): void {
  const inv = makeInvoice(invoiceKey, MERCHANT, PRICE, MEMO, INVOICE_TTL_SECONDS);
  const requirements: PaymentRequirements = {
    scheme: SCHEME,
    network: NETWORK,
    amount: PRICE,
    asset: USDC,
    payTo: MERCHANT,
    maxTimeoutSeconds: INVOICE_TTL_SECONDS,
    extra: { paymentFlow: "upfront", symbolon: { invoice: inv.text, invoiceSig: inv.sig, wallet: WALLET } },
  };
  const body: PaymentRequired = { x402Version: 2, error, resource: resourceOf(req), accepts: [requirements] };
  res.writeHead(402, { "Content-Type": "application/json", "PAYMENT-REQUIRED": b64json(body) });
  res.end(JSON.stringify(body));
  console.log(`402 issued invoice ${inv.id}: ${error}`);
}

async function verifyPayment(header: string): Promise<{ ok: true; invoiceId: string; settlement: SettlementResponse } | { ok: false; reason: string }> {
  let p: PaymentPayload;
  try {
    p = unb64json<PaymentPayload>(header);
  } catch {
    return { ok: false, reason: "PAYMENT-SIGNATURE is not base64 JSON" };
  }
  const a = p.accepted;
  if (p.x402Version !== 2 || a?.scheme !== SCHEME || a.network !== NETWORK || a.payTo !== MERCHANT || a.asset !== USDC || a.amount !== PRICE) {
    return { ok: false, reason: "payment does not match this resource's requirements" };
  }
  const text = a.extra?.symbolon?.invoice;
  const sigHex = a.extra?.symbolon?.invoiceSig;
  if (typeof text !== "string" || typeof sigHex !== "string") return { ok: false, reason: "missing invoice" };
  let inv;
  try {
    inv = parseInvoice(text);
  } catch {
    return { ok: false, reason: "malformed invoice" };
  }
  const sigOk = /^[0-9a-f]{128}$/.test(sigHex) && verify(null, Buffer.from(text), invoicePublicKey, Buffer.from(sigHex, "hex"));
  if (!sigOk || inv.payee !== MERCHANT || inv.amount !== PRICE || inv.memo !== MEMO) {
    return { ok: false, reason: "invoice was not issued by this merchant" };
  }
  if (inv.exp + PROOF_GRACE_SECONDS < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "invoice expired more than a day ago" };
  }
  if (served.has(inv.id)) return { ok: false, reason: "invoice already served" };
  if (verifying.has(inv.id)) return { ok: false, reason: "invoice payment is already being verified" };
  const { transaction, payer, signer } = p.payload ?? {};
  if (typeof transaction !== "string" || typeof payer !== "string") return { ok: false, reason: "payload needs transaction and payer" };
  if (signer !== undefined && typeof signer !== "string") return { ok: false, reason: "payload signer must be an account id" };

  verifying.add(inv.id);
  try {
    const result = await checkTransaction(transaction, payer, signer ?? payer, inv.id);
    if (!result.ok) return result;
    try {
      markServed(inv.id);
    } catch (e) {
      return { ok: false, reason: `cannot record served invoice: ${(e as Error).message}` };
    }
    return result;
  } finally {
    verifying.delete(inv.id);
  }
}

async function checkTransaction(
  transaction: string,
  payer: string,
  signer: string,
  invoiceId: string,
): Promise<{ ok: true; invoiceId: string; settlement: SettlementResponse } | { ok: false; reason: string }> {
  let t;
  try {
    t = await txOutcome(transaction, signer);
  } catch (e) {
    return { ok: false, reason: `transaction not found for ${signer}: ${(e as Error).message}` };
  }
  const agentPaid = t.signer === payer && t.receiver === payer && t.methods.includes("pay");
  const ownerApproved = t.receiver === payer && t.methods.includes("approve_held");
  if (!agentPaid && !ownerApproved) {
    return { ok: false, reason: "transaction is not a pay or approve_held call on the payer's wallet" };
  }
  if (!t.ok || t.value !== "paid") return { ok: false, reason: `wallet did not pay: ${t.value ?? t.failure}` };
  const transfer = t.events.find((e) => {
    const d = (e.event.data as Record<string, unknown>[] | undefined)?.[0] ?? {};
    return (
      e.executor === USDC &&
      e.event.standard === "nep141" &&
      e.event.event === "ft_transfer" &&
      d.old_owner_id === payer &&
      d.new_owner_id === MERCHANT &&
      d.amount === PRICE &&
      d.memo === `symbolon invoice ${invoiceId}`
    );
  });
  if (!transfer) return { ok: false, reason: "no USDC transfer to this merchant for this invoice" };
  return { ok: true, invoiceId, settlement: { success: true, transaction, network: NETWORK, payer } };
}

const server = createServer(async (req, res) => {
  if (req.method !== "GET" || req.url !== PATH) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const header = req.headers["payment-signature"];
  if (typeof header !== "string") {
    paymentRequired(req, res, "PAYMENT-SIGNATURE header is required");
    return;
  }
  const v = await verifyPayment(header);
  if (!v.ok) {
    console.log(`refused proof: ${v.reason}`);
    paymentRequired(req, res, v.reason);
    return;
  }
  const data = {
    feed: "demo market data snapshot",
    sample: true,
    at: new Date().toISOString(),
    quotes: [
      { symbol: "NEAR", usd: "3.79" },
      { symbol: "USDC", usd: "1.00" },
    ],
  };
  res.writeHead(200, { "Content-Type": "application/json", "PAYMENT-RESPONSE": b64json(v.settlement) });
  res.end(JSON.stringify(data));
  console.log(`200 served invoice ${v.invoiceId} for transaction ${v.settlement.transaction}`);
});

server.listen(PORT, () =>
  console.log(`merchant ${MERCHANT} listening on http://localhost:${PORT}${PATH}, ${served.size} served invoices in ${SERVED_FILE}`),
);
