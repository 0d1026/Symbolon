import { RPCS } from "../data/chain";

let preferred = 0;

async function rpc<T>(params: Record<string, unknown>): Promise<T> {
  let lastErr: unknown = new Error("No RPC endpoint reachable");
  for (let n = 0; n < RPCS.length; n++) {
    const idx = (preferred + n) % RPCS.length;
    try {
      const res = await fetch(RPCS[idx], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }),
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error.data ?? j.error.message ?? "RPC error");
      if (j.result?.error) throw new Error(j.result.error); // a contract-level error is final, do not retry elsewhere
      preferred = idx;
      return j.result as T;
    } catch (e) {
      lastErr = e;
      // Network failures and HTTP errors try the next node; chain answers are final.
      if (e instanceof Error && !/^RPC \d+$/.test(e.message) && !(e instanceof TypeError)) throw e;
    }
  }
  throw lastErr;
}

export async function view<T = unknown>(account: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>({
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  const text = new TextDecoder().decode(new Uint8Array(r.result));
  return JSON.parse(text) as T;
}

export const viewAccount = (account: string) =>
  rpc<{ code_hash: string; amount: string; storage_usage: number; block_height: number }>({ request_type: "view_account", finality: "final", account_id: account });

export const viewKeys = (account: string) =>
  rpc<{ keys: { public_key: string; access_key: { permission: "FullAccess" | { FunctionCall: unknown } } }[] }>({ request_type: "view_access_key_list", finality: "final", account_id: account });

/** base units (6 decimals) -> "12.5" */
export function usdc(units: string | number | bigint): string {
  const v = BigInt(units);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
}
