import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, JsonRpcProvider, KeyPairSigner, actions } from "near-api-js";

export const NETWORK = "near:testnet";
export const SCHEME = "symbolon-attested";
export const RPC_URL = "https://rpc.testnet.near.org";
export const NEAR_AI = "https://cloud-api.near.ai/v1";
export const WALLET = "v2.symbolon.testnet";
export const USDC = "symbolon-usdc.testnet";
export const MERCHANT = "symbolon-merchant.testnet";

const KEYS = join(homedir(), ".symbolon");
const TGAS = 1_000_000_000_000n;

export const provider = new JsonRpcProvider({ url: RPC_URL });

export const sha256 = (b: Buffer | string): Buffer => createHash("sha256").update(b).digest();
export const sha256Hex = (b: Buffer | string): string => sha256(b).toString("hex");
export const b64json = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64");
export const unb64json = <T>(s: string): T => JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;

export interface Policy {
  model_id: string;
  profile: string;
  prefix: string;
  middle: string;
  suffix: string;
}

export function policy(): Policy {
  return JSON.parse(readFileSync(new URL("../../spec/policy-testnet.json", import.meta.url), "utf8")) as Policy;
}

export function nearAiKey(): string {
  if (process.env.NEAR_AI_CLOUD_API_KEY) return process.env.NEAR_AI_CLOUD_API_KEY;
  const line = readFileSync(join(homedir(), ".nearai.env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("NEAR_AI_CLOUD_API_KEY="));
  if (!line) throw new Error("NEAR_AI_CLOUD_API_KEY not set");
  return line.split("=")[1].trim();
}

export async function fetchRetry(url: string, init?: RequestInit, attempts = 5): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (i >= attempts) throw new Error(`network error after ${attempts} attempts to ${new URL(url).host}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

export function invoiceSigner(file: string): KeyObject {
  const { seed_hex } = JSON.parse(readFileSync(join(KEYS, file), "utf8")) as { seed_hex: string };
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed_hex, "hex")]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export interface Invoice {
  id: string;
  payee: string;
  amount: string;
  exp: number;
  memo: string;
  text: string;
  sig: string;
}

export function makeInvoice(signer: KeyObject, payee: string, amount: string, memo: string, ttlSeconds = 600): Invoice {
  const id = sha256Hex(`${Date.now()}:${Math.random()}`).slice(0, 16);
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const text = `inv1|id=${id}|payee=${payee}|amount=${amount}|token=usdc|exp=${exp}|memo=${memo}`;
  return { id, payee, amount, exp, memo, text, sig: sign(null, Buffer.from(text), signer).toString("hex") };
}

export function parseInvoice(text: string): Omit<Invoice, "sig" | "text"> {
  const m = /^inv1\|id=([0-9a-f]{16})\|payee=([a-z0-9._-]+)\|amount=([1-9][0-9]*)\|token=usdc\|exp=([0-9]+)\|memo=([A-Za-z0-9 ]{0,64})$/.exec(text);
  if (!m) throw new Error("malformed invoice");
  return { id: m[1], payee: m[2], amount: m[3], exp: Number(m[4]), memo: m[5] };
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { paymentFlow: "upfront"; symbolon: { invoice: string; invoiceSig: string; wallet: string } };
}

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirements[];
}

export interface PaymentPayload {
  x402Version: 2;
  resource: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { transaction: string; payer: string };
}

export interface SettlementResponse {
  success: boolean;
  transaction: string;
  network: string;
  payer: string;
  errorReason?: string;
}

export function agentAccount(): Account {
  const k = JSON.parse(readFileSync(join(KEYS, "agent-testnet-access-key.json"), "utf8")) as {
    account_id: string;
    private_key: `ed25519:${string}`;
  };
  if (k.account_id !== WALLET) throw new Error(`agent key is for ${k.account_id}, not ${WALLET}`);
  return new Account(WALLET, provider, KeyPairSigner.fromSecretKey(k.private_key));
}

type TxResult = Awaited<ReturnType<Account["signAndSendTransaction"]>>;

export interface CallOutcome {
  tx: string;
  ok: boolean;
  value: string | null;
  failure: string | null;
  events: { executor: string; event: Record<string, unknown> }[];
}

export function outcomeOf(r: TxResult): CallOutcome {
  const status = r.status as Record<string, unknown>;
  const success = typeof status === "object" && status !== null && "SuccessValue" in status;
  const raw = success ? Buffer.from(String(status.SuccessValue), "base64").toString("utf8") : "";
  const events = r.receipts_outcome.flatMap((o) =>
    o.outcome.logs
      .filter((l) => l.startsWith("EVENT_JSON:"))
      .map((l) => ({ executor: o.outcome.executor_id, event: JSON.parse(l.slice(11)) as Record<string, unknown> })),
  );
  return {
    tx: r.transaction_outcome.id,
    ok: success,
    value: raw ? (JSON.parse(raw) as string) : null,
    failure: success ? null : JSON.stringify(status.Failure ?? status),
    events,
  };
}

export async function callWallet(account: Account, method: string, args: Uint8Array | Record<string, unknown>, gasTgas: number): Promise<CallOutcome> {
  const r = await account.signAndSendTransaction({
    receiverId: WALLET,
    actions: [actions.functionCall(method, args, BigInt(gasTgas) * TGAS, 0n)],
    throwOnFailure: false,
  });
  return outcomeOf(r);
}

const borshBytes = (b: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};

export function payArgs(invoice: string, invoiceSigHex: string, response: Buffer, signature: string): Uint8Array {
  return new Uint8Array(
    Buffer.concat([
      borshBytes(Buffer.from(invoice, "utf8")),
      borshBytes(Buffer.from(invoiceSigHex, "hex")),
      borshBytes(response),
      borshBytes(Buffer.from(signature, "utf8")),
    ]),
  );
}

export function ownerRequest(nonce: string, invoice: string): Buffer {
  const p = policy();
  return Buffer.from(p.prefix + nonce + p.middle + invoice + p.suffix, "utf8");
}

export interface SignedDecision {
  responseBytes: Buffer;
  content: string;
  signature: string;
  signatureKind: string;
  signingAddress: string;
}

export async function signedDecision(requestBytes: Buffer): Promise<SignedDecision> {
  const key = nearAiKey();
  const res = await fetchRetry(`${NEAR_AI}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Accept-Encoding": "identity",
      "x-no-aliasing": "true",
    },
    body: new Uint8Array(requestBytes),
  });
  const responseBytes = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${responseBytes.toString("utf8")}`);
  const completion = JSON.parse(responseBytes.toString("utf8")) as { id: string; choices: { message: { content: string } }[] };
  const model = policy().model_id;
  for (let i = 0; i < 15; i++) {
    const s = await fetchRetry(`${NEAR_AI}/signature/${completion.id}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`, {
      headers: { Authorization: `Bearer ${key}`, "x-no-aliasing": "true" },
    });
    if (s.ok) {
      const body = (await s.json()) as { text?: string; signature?: string; signature_kind?: string; signing_address?: string };
      if (body.signature && body.text) {
        const parts = body.text.split(":");
        if (parts.at(-2) !== sha256Hex(requestBytes) || parts.at(-1) !== sha256Hex(responseBytes)) {
          throw new Error("NEAR AI signed hashes do not match the bytes sent and received");
        }
        if (body.signature_kind !== "provider_tee") throw new Error(`signature kind ${body.signature_kind}, need provider_tee`);
        return {
          responseBytes,
          content: completion.choices[0].message.content,
          signature: body.signature,
          signatureKind: body.signature_kind,
          signingAddress: String(body.signing_address),
        };
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`no signature for completion ${completion.id}`);
}

export async function txOutcome(txHash: string, sender: string): Promise<CallOutcome & { signer: string; receiver: string; methods: string[] }> {
  const r = (await provider.viewTransactionStatus({ txHash, accountId: sender, waitUntil: "FINAL" })) as TxResult;
  const t = r.transaction as unknown as { signer_id: string; receiver_id: string; actions: unknown[] };
  const methods = t.actions.flatMap((a) =>
    typeof a === "object" && a !== null && "FunctionCall" in a ? [String((a as { FunctionCall: { method_name: string } }).FunctionCall.method_name)] : [],
  );
  return { ...outcomeOf(r), signer: t.signer_id, receiver: t.receiver_id, methods };
}
