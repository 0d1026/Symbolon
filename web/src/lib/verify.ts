import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { POLICY, MERCHANT_KEY } from "../data/signed";

const enc = new TextEncoder();
const toHex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => {
  const s = h.trim().replace(/^0x/, "");
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw new Error("not hex");
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
};

export const sha256Hex = (s: string | Uint8Array) => toHex(sha256(typeof s === "string" ? enc.encode(s) : s));

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The exact request bytes the owner approves: prefix + nonce + middle + invoice + suffix. */
export const rebuildRequest = (nonce: string, invoice: string) =>
  POLICY.prefix + nonce + POLICY.middle + invoice + POLICY.suffix;

/** EIP-191 personal_sign recovery, as the contract does it. Returns a 0x address. */
export function recoverSigner(text: string, signature: string): string {
  const sig = fromHex(signature);
  if (sig.length !== 65) throw new Error("signature must be 65 bytes");
  if (sig[64] !== 27 && sig[64] !== 28) throw new Error("signature v must be 27 or 28");
  const textLen = enc.encode(text).length;
  const hash = keccak_256(enc.encode(`\x19Ethereum Signed Message:\n${textLen}${text}`));
  const rec = new Uint8Array(65);
  rec[0] = sig[64] - 27;
  rec.set(sig.subarray(0, 64), 1);
  const compressed = secp256k1.recoverPublicKey(rec, hash, { prehash: false });
  const point = secp256k1.Point.fromBytes(compressed).toBytes(false);
  return "0x" + toHex(keccak_256(point.subarray(1)).subarray(12));
}

export function merchantSigOk(invoice: string, sigHex: string): boolean {
  try {
    return ed25519.verify(fromHex(sigHex), enc.encode(invoice), fromHex(MERCHANT_KEY));
  } catch {
    return false;
  }
}

export type Decision = { approve: boolean; payee: string; amount: string; invoice_id: string };

export function readDecision(response: string): Decision {
  const outer = JSON.parse(response);
  const content = outer?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no message content");
  const d = JSON.parse(content);
  if (typeof d.approve !== "boolean" || typeof d.payee !== "string" || typeof d.amount !== "string" || typeof d.invoice_id !== "string") {
    throw new Error("decision fields are missing");
  }
  return d as Decision;
}

export type InvoiceFields = { id: string; payee: string; amount: string };
export function readInvoice(invoice: string): InvoiceFields | null {
  if (!invoice.startsWith("inv1|")) return null;
  const f = Object.fromEntries(invoice.split("|").slice(1).map((p) => { const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1)]; }));
  if (!f.id || !f.payee || !f.amount) return null;
  return { id: f.id, payee: f.payee, amount: f.amount };
}
