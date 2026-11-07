// Live end-to-end payment on testnet, signed with the agent's function-call key.
//
// Usage: node scripts/live_pay.mjs <amount_base_units> "<memo>"
// Keys live outside the repo in ~/.symbolon; the NEAR AI key in ~/.nearai.env.

import { createHash, createPrivateKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WALLET = "v2.symbolon.testnet";
const MERCHANT = "symbolon-merchant.testnet";
const BASE = "https://cloud-api.near.ai/v1";
const HOME = homedir();
const AGENT_KEY_FILE = join(HOME, ".symbolon", "agent-testnet-access-key.json");

const sha256 = (b) => createHash("sha256").update(b).digest();

function apiKey() {
  const line = readFileSync(join(HOME, ".nearai.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("NEAR_AI_CLOUD_API_KEY="));
  if (!line) throw new Error("NEAR_AI_CLOUD_API_KEY not set");
  return line.split("=")[1].trim();
}

function merchantKey() {
  const { seed_hex } = JSON.parse(readFileSync(join(HOME, ".symbolon", "merchant-invoice-testnet.json")));
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed_hex, "hex")]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function borshString(s) {
  return borshBytes(Buffer.from(s, "utf8"));
}

function borshBytes(b) {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
}

function nearCall(method, argsKind, args, gas) {
  const run = spawnSync(
    "near",
    [
      "contract", "call-function", "as-transaction", WALLET, method, argsKind, args,
      "prepaid-gas", gas, "attached-deposit", "0 NEAR",
      "sign-as", WALLET, "network-config", "testnet",
      "sign-with-access-key-file", AGENT_KEY_FILE, "send",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 },
  );
  const out = `${run.stdout}\n${run.stderr}`;
  if (run.status !== 0) throw new Error(`near ${method} failed:\n${out}`);
  const tx = out.match(/Transaction ID: (\w+)/)?.[1];
  const value = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith('"')).at(-1);
  const events = out
    .split("\n")
    .filter((l) => l.includes("EVENT_JSON:"))
    .map((l) => l.slice(l.indexOf("EVENT_JSON:")));
  return { tx, value: value ? JSON.parse(value) : undefined, events };
}

async function main() {
  const [amount, memo] = process.argv.slice(2);
  if (!amount || !memo) throw new Error('usage: live_pay.mjs <amount_base_units> "<memo>"');
  const policy = JSON.parse(readFileSync(new URL("../spec/policy-testnet.json", import.meta.url)));
  const key = apiKey();

  const id = createHash("sha256").update(`${Date.now()}${Math.random()}`).digest("hex").slice(0, 16);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const invoice = `inv1|id=${id}|payee=${MERCHANT}|amount=${amount}|token=usdc|exp=${exp}|memo=${memo}`;
  const invoiceSig = sign(null, Buffer.from(invoice), merchantKey());
  console.log("invoice", invoice);

  const n = nearCall("request_nonce", "json-args", JSON.stringify({ invoice_hash: sha256(invoice).toString("hex") }), "30 Tgas");
  console.log("request_nonce tx", n.tx, "nonce", n.value);

  const requestBytes = Buffer.from(policy.prefix + n.value + policy.middle + invoice + policy.suffix);
  JSON.parse(requestBytes);
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Accept-Encoding": "identity",
      "x-no-aliasing": "true",
    },
    body: requestBytes,
  });
  const responseBytes = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`completion ${res.status}: ${responseBytes}`);
  const completion = JSON.parse(responseBytes);
  console.log("decision", completion.choices[0].message.content, "provider", res.headers.get("x-serving-provider"));

  let sig;
  for (let i = 0; i < 15 && !sig; i++) {
    const r = await fetch(`${BASE}/signature/${completion.id}?model=${encodeURIComponent(policy.model_id)}&signing_algo=ecdsa`, {
      headers: { Authorization: `Bearer ${key}`, "x-no-aliasing": "true" },
    });
    if (r.ok) {
      const body = await r.json();
      if (body.signature) sig = body;
    }
    if (!sig) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!sig) throw new Error("no signature");
  const parts = sig.text.split(":");
  if (sig.signature_kind !== "provider_tee") throw new Error(`signature kind ${sig.signature_kind}`);
  if (parts.at(-2) !== sha256(requestBytes).toString("hex") || parts.at(-1) !== sha256(responseBytes).toString("hex")) {
    throw new Error("signed hashes do not match our bytes");
  }
  console.log("signature", sig.signature_kind, sig.signing_address);

  const args = Buffer.concat([
    borshString(invoice),
    borshBytes(invoiceSig),
    borshBytes(responseBytes),
    borshString(sig.signature),
  ]);
  const p = nearCall("pay", "base64-args", args.toString("base64"), "100 Tgas");
  console.log("pay tx", p.tx, "result", p.value);
  for (const e of p.events) console.log(e);
}

main().catch((e) => {
  console.error(e.stderr?.toString() || e.message);
  process.exit(1);
});
