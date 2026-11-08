import { writeFileSync } from "node:fs";
import { purchase } from "./agent.js";
import { b64json, fetchRetry, unb64json, type PaymentPayload, type PaymentRequired } from "./lib.js";

const REFUSED_PAY_TX = "4K3FyWkTVmePfbVo7NLgAN7HCDCYXr6xTk9LchThjYNB";

interface Check {
  name: string;
  status: number;
  merchant_error: string | null;
  expected: string;
  passed: boolean;
}

async function send(url: string, proof: PaymentPayload | null): Promise<{ status: number; error: string | null }> {
  const res = await fetchRetry(url, proof ? { headers: { "PAYMENT-SIGNATURE": b64json(proof) } } : undefined);
  const header = res.headers.get("payment-required");
  await res.text();
  return { status: res.status, error: header ? (unb64json<PaymentRequired>(header).error ?? null) : null };
}

async function freshRequirements(url: string): Promise<PaymentRequired> {
  const res = await fetchRetry(url);
  const header = res.headers.get("payment-required");
  await res.text();
  if (res.status !== 402 || !header) throw new Error("merchant did not answer 402");
  return unb64json<PaymentRequired>(header);
}

async function main(): Promise<void> {
  const [url, out] = process.argv.slice(2);
  if (!url || !out) throw new Error("usage: npx tsx src/checks.ts <url> <out.json>");

  const honest = await purchase(url);
  if (honest.status !== 200 || !honest.proof) throw new Error("honest purchase failed, checks not run");
  const paid = honest.proof;
  const checks: Check[] = [];
  const record = (name: string, expected: string, r: { status: number; error: string | null }) =>
    checks.push({ name, status: r.status, merchant_error: r.error, expected, passed: r.status === 402 && (r.error ?? "").includes(expected) });

  record("no payment proof", "PAYMENT-SIGNATURE header is required", await send(url, null));

  record("reuse the paid proof", "invoice already served", await send(url, paid));

  const other = await freshRequirements(url);
  record(
    "paid transaction claimed for a new invoice",
    "no USDC transfer to this merchant for this invoice",
    await send(url, { ...paid, accepted: other.accepts[0] }),
  );

  const another = await freshRequirements(url);
  record(
    "refused payment transaction",
    "wallet did not pay",
    await send(url, { ...paid, accepted: another.accepts[0], payload: { ...paid.payload, transaction: REFUSED_PAY_TX } }),
  );

  const third = await freshRequirements(url);
  record(
    "transaction that is not a payment",
    "transaction is not a pay or approve_held call",
    await send(url, { ...paid, accepted: third.accepts[0], payload: { ...paid.payload, transaction: String(honest.nonceTx) } }),
  );

  const unserved = await purchase(url, false);
  if (!unserved.proof) throw new Error("second purchase failed, concurrency check not run");
  const both = await Promise.all([send(url, unserved.proof), send(url, unserved.proof)]);
  const served = both.filter((r) => r.status === 200).length;
  const refused = both.find((r) => r.status === 402);
  checks.push({
    name: "same fresh proof sent twice at once",
    status: refused?.status ?? 0,
    merchant_error: refused?.error ?? null,
    expected: "exactly one 200",
    passed: served === 1 && refused !== undefined && /being verified|already served/.test(refused.error ?? ""),
  });

  const result = {
    at: new Date().toISOString(),
    url,
    honest: { pay_tx: honest.payTx, nonce_tx: honest.nonceTx, status: honest.status },
    concurrent: { pay_tx: unserved.payTx, nonce_tx: unserved.nonceTx, statuses: both.map((r) => r.status) },
    checks,
  };
  writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
  for (const c of checks) console.log(`${c.passed ? "PASS" : "FAIL"} ${c.name}: ${c.status} ${c.merchant_error}`);
  if (checks.some((c) => !c.passed)) process.exitCode = 1;
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
