import { createHash, createPrivateKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const WALLET = "v2.symbolon.testnet";
export const OWNER = "symbolon.testnet";
export const USDC = "symbolon-usdc.testnet";
export const MERCHANT = "symbolon-merchant.testnet";
export const ATTACKER = "symbolon-attacker.testnet";
export const NEAR_AI = "https://cloud-api.near.ai/v1";

const HOME = homedir();
const KEYS = join(HOME, ".symbolon");
export const AGENT_KEY_FILE = join(KEYS, "agent-testnet-access-key.json");

export async function fetchRetry(url, options, attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (i >= attempts) throw new Error(`network error after ${attempts} attempts to ${new URL(url).host}: ${e.cause?.code ?? e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

export const sha256 = (b) => createHash("sha256").update(b).digest();
export const sha256Hex = (b) => sha256(b).toString("hex");

export function policy() {
  return JSON.parse(readFileSync(new URL("../../spec/policy-testnet.json", import.meta.url)));
}

export function apiKey() {
  const line = readFileSync(join(HOME, ".nearai.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("NEAR_AI_CLOUD_API_KEY="));
  if (!line) throw new Error("NEAR_AI_CLOUD_API_KEY not set in ~/.nearai.env");
  return line.split("=")[1].trim();
}

function invoiceKey(file) {
  const { seed_hex } = JSON.parse(readFileSync(join(KEYS, file)));
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed_hex, "hex")]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export const merchantSigner = () => invoiceKey("merchant-invoice-testnet.json");
export const attackerSigner = () => invoiceKey("attacker-invoice-testnet.json");

export function newInvoice({ payee = MERCHANT, amount, memo, signer = merchantSigner() }) {
  const id = sha256Hex(`${Date.now()}:${Math.random()}`).slice(0, 16);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const invoice = `inv1|id=${id}|payee=${payee}|amount=${amount}|token=usdc|exp=${exp}|memo=${memo}`;
  return { id, invoice, sig: sign(null, Buffer.from(invoice), signer) };
}

export function ownerRequest(nonce, invoice) {
  const p = policy();
  return Buffer.from(p.prefix + nonce + p.middle + invoice + p.suffix);
}

const borshBytes = (b) => {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};
const borshString = (s) => borshBytes(Buffer.from(s, "utf8"));

export function payArgs({ invoice, sig, response, signature }) {
  return Buffer.concat([borshString(invoice), borshBytes(sig), borshBytes(response), borshString(signature)]).toString("base64");
}

export function near({ contract, method, argsKind = "json-args", args = "{}", gas = "30 Tgas", deposit = "0 NEAR", as }) {
  const signing =
    as === "agent"
      ? ["sign-as", WALLET, "network-config", "testnet", "sign-with-access-key-file", AGENT_KEY_FILE, "send"]
      : ["sign-as", as, "network-config", "testnet", "sign-with-keychain", "send"];
  const run = spawnSync(
    "near",
    ["contract", "call-function", "as-transaction", contract, method, argsKind, args, "prepaid-gas", gas, "attached-deposit", deposit, ...signing],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 },
  );
  const out = `${run.stdout}\n${run.stderr}`;
  const lines = out.split("\n").map((l) => l.trim());
  const value = lines.filter((l) => l.startsWith('"')).at(-1);
  const panic = out.match(/Smart contract panicked: ([^\n"]+)/)?.[1];
  const rpcError = lines.find((l) => /^Error:|InvalidTxError|ActionError|MethodNameMismatch|DepositWithFunctionCall/.test(l));
  return {
    ok: run.status === 0 && !panic,
    tx: out.match(/Transaction ID: (\w+)/)?.[1] ?? null,
    value: value ? JSON.parse(value) : null,
    events: lines.filter((l) => l.includes("EVENT_JSON:")).map((l) => l.slice(l.indexOf("EVENT_JSON:") + 11)),
    error: panic ?? (run.status === 0 ? null : (rpcError ?? lines.filter(Boolean).slice(-3).join(" "))),
  };
}

export async function view(contract, method, args = {}) {
  const res = await fetchRetry("https://rpc.testnet.near.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const body = await res.json();
  if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
  return JSON.parse(Buffer.from(body.result.result).toString());
}

export const usdcBalance = async (account) => BigInt(await view(USDC, "ft_balance_of", { account_id: account }));

export async function askModel(requestBytes) {
  const res = await fetchRetry(`${NEAR_AI}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      "Accept-Encoding": "identity",
      "x-no-aliasing": "true",
    },
    body: requestBytes,
  });
  const responseBytes = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${responseBytes}`);
  const completion = JSON.parse(responseBytes);
  return {
    responseBytes,
    completion,
    content: completion.choices[0].message.content,
    provider: res.headers.get("x-serving-provider"),
  };
}

export async function fetchSignature(completionId, model) {
  for (let i = 0; i < 15; i++) {
    const res = await fetchRetry(`${NEAR_AI}/signature/${completionId}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`, {
      headers: { Authorization: `Bearer ${apiKey()}`, "x-no-aliasing": "true" },
    });
    if (res.ok) {
      const body = await res.json();
      if (body.signature) return body;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`no signature for ${completionId}`);
}

export async function signedDecision(requestBytes) {
  const model = policy().model_id;
  const answer = await askModel(requestBytes);
  const sig = await fetchSignature(answer.completion.id, model);
  const [, reqHash, respHash] = sig.text.split(":").slice(-3);
  if (reqHash !== sha256Hex(requestBytes) || respHash !== sha256Hex(answer.responseBytes)) {
    throw new Error("NEAR AI signed hashes do not match the bytes sent and received");
  }
  return { ...answer, signature: sig.signature, signatureKind: sig.signature_kind, signingAddress: sig.signing_address };
}

export function requestNonce(invoice) {
  const r = near({ contract: WALLET, method: "request_nonce", args: JSON.stringify({ invoice_hash: sha256Hex(invoice) }), as: "agent" });
  if (!r.ok) throw new Error(`request_nonce failed: ${r.error}`);
  return { nonce: r.value, tx: r.tx };
}

export function pay(submission) {
  return near({ contract: WALLET, method: "pay", argsKind: "base64-args", args: payArgs(submission), gas: "100 Tgas", as: "agent" });
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex");
  let zeros = 0;
  while (s[zeros] === "1") zeros++;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

async function rpc(method, params) {
  const res = await fetchRetry("https://rpc.testnet.near.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

const u128 = (n) => {
  const b = Buffer.alloc(16);
  b.writeBigUInt64LE(BigInt(n) & 0xffffffffffffffffn, 0);
  b.writeBigUInt64LE(BigInt(n) >> 64n, 8);
  return b;
};

export async function rawAgentCall({ receiver, method, args, gasTgas = 30, depositYocto = 0 }) {
  const { public_key, private_key } = JSON.parse(readFileSync(AGENT_KEY_FILE, "utf8"));
  const pub = b58decode(public_key.split(":")[1]);
  const secret = b58decode(private_key.split(":")[1]);
  const key = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: WALLET, public_key });
  if (key.error || key.result?.error) throw new Error(JSON.stringify(key.error ?? key.result.error));
  const blockHash = b58decode(key.result.block_hash);
  const action = Buffer.concat([
    Buffer.from([2]),
    borshString(method),
    borshBytes(Buffer.from(args)),
    u64(BigInt(gasTgas) * 1_000_000_000_000n),
    u128(depositYocto),
  ]);
  const tx = Buffer.concat([
    borshString(WALLET),
    Buffer.from([0]),
    pub,
    u64(BigInt(key.result.nonce) + 1n),
    borshString(receiver),
    blockHash,
    u32(1),
    action,
  ]);
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), secret.subarray(0, 32)]);
  const signature = sign(null, sha256(tx), createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  const signed = Buffer.concat([tx, Buffer.from([0]), signature]);
  const out = await rpc("send_tx", { signed_tx_base64: signed.toString("base64"), wait_until: "EXECUTED_OPTIMISTIC" });
  return {
    ok: !out.error && !JSON.stringify(out.result?.status ?? {}).includes("Failure"),
    rpc_error: out.error ? JSON.stringify(out.error.data ?? out.error.cause ?? out.error) : null,
    tx: out.result?.transaction?.hash ?? null,
  };
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
