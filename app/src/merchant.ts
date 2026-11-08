import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

const MAX_OPEN_INVOICES = 1000;
const INVOICE_TTL_SECONDS = 600;

type InvoiceState = "open" | "verifying" | "served";
const signer = invoiceSigner("merchant-invoice-testnet.json");
const issued = new Map<string, { invoice: string; exp: number; state: InvoiceState }>();

function pruneExpired(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, r] of issued) {
    if (r.state === "open" && r.exp <= now) issued.delete(id);
  }
}

function openInvoices(): number {
  let n = 0;
  for (const r of issued.values()) if (r.state !== "served") n++;
  return n;
}

function resourceOf(req: IncomingMessage): PaymentRequired["resource"] {
  return {
    url: `http://${req.headers.host ?? `localhost:${PORT}`}${PATH}`,
    description: "Market data feed snapshot",
    mimeType: "application/json",
  };
}

function paymentRequired(req: IncomingMessage, res: ServerResponse, error: string): void {
  pruneExpired();
  if (openInvoices() >= MAX_OPEN_INVOICES) {
    res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "60" });
    res.end(JSON.stringify({ error: "too many open invoices, retry later" }));
    console.log("503 open invoice limit reached");
    return;
  }
  const inv = makeInvoice(signer, MERCHANT, PRICE, MEMO, INVOICE_TTL_SECONDS);
  issued.set(inv.id, { invoice: inv.text, exp: inv.exp, state: "open" });
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
  let inv;
  try {
    inv = parseInvoice(a.extra.symbolon.invoice);
  } catch {
    return { ok: false, reason: "malformed invoice" };
  }
  const record = issued.get(inv.id);
  if (!record || record.invoice !== a.extra.symbolon.invoice) return { ok: false, reason: "invoice was not issued by this merchant" };
  if (record.state === "served") return { ok: false, reason: "invoice already served" };
  if (record.state === "verifying") return { ok: false, reason: "invoice payment is already being verified" };
  const { transaction, payer } = p.payload ?? {};
  if (typeof transaction !== "string" || typeof payer !== "string") return { ok: false, reason: "payload needs transaction and payer" };

  record.state = "verifying";
  const result = await checkTransaction(transaction, payer, inv.id);
  record.state = result.ok ? "served" : "open";
  return result;
}

async function checkTransaction(
  transaction: string,
  payer: string,
  invoiceId: string,
): Promise<{ ok: true; invoiceId: string; settlement: SettlementResponse } | { ok: false; reason: string }> {
  let t;
  try {
    t = await txOutcome(transaction, payer);
  } catch (e) {
    return { ok: false, reason: `transaction not found for ${payer}: ${(e as Error).message}` };
  }
  if (t.signer !== payer || t.receiver !== payer || !t.methods.includes("pay")) {
    return { ok: false, reason: "transaction is not a pay call on the payer's wallet" };
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

server.listen(PORT, () => console.log(`merchant ${MERCHANT} listening on http://localhost:${PORT}${PATH}`));
