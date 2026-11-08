import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { purchase } from "./agent.js";
import { WALLET, b64json, fetchRetry, unb64json, type PaymentPayload, type SettlementResponse } from "./lib.js";

const OWNER = "symbolon.testnet";

function ownerApprove(heldId: number): { tx: string | null; value: string | null; output: string } {
  const run = spawnSync(
    "near",
    [
      "contract", "call-function", "as-transaction", WALLET, "approve_held", "json-args", JSON.stringify({ held_id: heldId }),
      "prepaid-gas", "100 Tgas", "attached-deposit", "0 NEAR",
      "sign-as", OWNER, "network-config", "testnet", "sign-with-keychain", "send",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = `${run.stdout}\n${run.stderr}`;
  const value = output.split("\n").map((l) => l.trim()).filter((l) => l.startsWith('"')).at(-1);
  return { tx: output.match(/Transaction ID: (\w+)/)?.[1] ?? null, value: value ? (JSON.parse(value) as string) : null, output };
}

async function main(): Promise<void> {
  const [url, out] = process.argv.slice(2);
  if (!url || !out) throw new Error("usage: npx tsx src/held.ts <url of a merchant priced above the threshold> <out.json>");

  const p = await purchase(url);
  if (!p.payValue?.startsWith("held:") || !p.required) throw new Error(`expected a held payment, got ${p.payValue}`);
  const heldId = Number(p.payValue.split(":")[1]);
  console.log(`held payment ${heldId}, pay ${p.payTx}`);

  const before = await fetchRetry(url, {
    headers: {
      "PAYMENT-SIGNATURE": b64json({ x402Version: 2, resource: p.required.resource, accepted: p.required.accepts[0], payload: { transaction: String(p.payTx), payer: WALLET } } satisfies PaymentPayload),
    },
  });
  const beforeError = before.headers.get("payment-required");
  await before.text();
  console.log(`proof with the held pay transaction: ${before.status}`);

  const approval = ownerApprove(heldId);
  if (approval.value !== "paid" || !approval.tx) throw new Error(`owner approval did not pay:\n${approval.output}`);
  console.log(`owner approve_held ${approval.tx} -> ${approval.value}`);

  const proof: PaymentPayload = {
    x402Version: 2,
    resource: p.required.resource,
    accepted: p.required.accepts[0],
    payload: { transaction: approval.tx, payer: WALLET, signer: OWNER },
  };
  const after = await fetchRetry(url, { headers: { "PAYMENT-SIGNATURE": b64json(proof) } });
  const settlement = after.headers.get("payment-response");
  const body = await after.text();
  console.log(`proof with the owner's approval: ${after.status}`);
  if (settlement) console.log(`settlement ${JSON.stringify(unb64json<SettlementResponse>(settlement))}`);

  const result = {
    at: new Date().toISOString(),
    url,
    pay_tx: p.payTx,
    nonce_tx: p.nonceTx,
    pay_result: p.payValue,
    proof_with_held_pay_status: before.status,
    proof_with_held_pay_error: beforeError ? (unb64json<{ error?: string }>(beforeError).error ?? null) : null,
    approve_tx: approval.tx,
    proof_with_approval_status: after.status,
    served: after.status === 200 ? JSON.parse(body) : null,
  };
  writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
  if (before.status !== 402 || after.status !== 200) process.exitCode = 1;
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
