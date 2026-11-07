import { newInvoice, ownerRequest, pay, requestNonce, signedDecision } from "./lib/symbolon.mjs";

async function main() {
  const [amount, memo] = process.argv.slice(2);
  if (!amount || !memo) throw new Error('usage: node scripts/live_pay.mjs <amount_base_units> "<memo>"');

  const inv = newInvoice({ amount, memo });
  console.log("invoice", inv.invoice);

  const n = requestNonce(inv.invoice);
  console.log("request_nonce tx", n.tx, "nonce", n.nonce);

  const d = await signedDecision(ownerRequest(n.nonce, inv.invoice));
  console.log("decision", d.content, "provider", d.provider);
  if (d.signatureKind !== "provider_tee") throw new Error(`signature kind ${d.signatureKind}`);
  console.log("signature", d.signatureKind, d.signingAddress);

  const r = pay({ invoice: inv.invoice, sig: inv.sig, response: d.responseBytes, signature: d.signature });
  console.log("pay tx", r.tx, "result", r.value ?? r.error);
  for (const e of r.events) console.log(e);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
