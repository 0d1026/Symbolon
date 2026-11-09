export const WALLET = "v2.symbolon.testnet";
export const OWNER = "symbolon.testnet";
export const VERIFIER = "tee-verifier.symbolon.testnet";
export const USDC = "symbolon-usdc.testnet";
export const MERCHANT = "symbolon-merchant.testnet";
export const MODEL_KEY = "0x3b753b4406613c5e70ae640508632b600424fa0c";
export const PROFILE = "z-ai/glm-5.3-flash";
export const VERIFIER_HASH = "6RHv9Er2kDegVjCDcHaBvpbgjmgq5nAHodyBiHC4gZpa";
// rpc.testnet.near.org is deprecated and answers 429 without CORS headers, so it goes last.
export const RPCS = [
  "https://test.rpc.fastnear.com",
  "https://archival-rpc.testnet.near.org",
  "https://rpc.testnet.near.org",
];
export const RPC = RPCS[0];
export const REPO = "https://github.com/0d1026/Symbolon";

export const ACCOUNTS = [
  { id: WALLET, role: "Symbolon wallet, production build" },
  { id: VERIFIER, role: "NEAR One TDX verifier, mainnet code, locked" },
  { id: USDC, role: "Mock USDC, NEP-141, 6 decimals" },
  { id: MERCHANT, role: "Demo merchant, cap 60 USDC" },
  { id: OWNER, role: "Owner" },
];

export const EVENTS = [
  { label: "Wallet upgraded in place, migrate in the same transaction", id: "7aaxykzmYNbipm3hczGenfn9J1VA8ue5hruhgrtf8SrH" },
  { label: "Model key 0x3b75…fa0c registered through the verifier", id: "4wi6DGRzTxii67rrXiU7944JekDeuySVVm5Lj1VBoxbz" },
  { label: "Gateway key 0xb98a…e779 registered through the verifier", id: "LxLKsMgno5hXMF3kePZXBeesuQbr4NcqS8YbcbqKT7a" },
  { label: "Payment, 2 USDC", id: "BmjpZZ6iXAxK9KvX4fxTxK9YNE1ovxUumogGhe3N7YMc" },
  { label: "Forged approval refused", id: "4K3FyWkTVmePfbVo7NLgAN7HCDCYXr6xTk9LchThjYNB" },
  { label: "Prompt injected payment to attacker refused", id: "9KPhvQXEmPe7peVXCGaehgKaqhwStdgwjEhrRcyGNduF" },
  { label: "Held 50 USDC payment approved by owner", id: "3MHZRQvwBwiEFxVLStEYkdRsriwJ7EqhKSuTJY8cZBNF" },
  { label: "HTTP 402 purchase", id: "2kj5MfBXPovzF39nCWQqxRNJ7ESc7QPxGSG2rWNmhox5" },
];

export const SETUP = [
  { label: "Deploy mock USDC", id: "919EGCRSyitwMzMu99HVmdCUrr8QmTUPH7tGve1KLpWB" },
  { label: "Create v2.symbolon.testnet", id: "D8d16HyyC8z5vtDscUxY9gDgYgFtiDAaVsfpMX1kYU2r" },
  { label: "Deploy and initialise Symbolon v2", id: "BjDCjfLakEybxhdy1mQjhhvdB4zjCmPvyugUpmpUDGpG" },
  { label: "Owner sets the z-ai/glm-5.3-flash profile", id: "BVbevG4pucj7B53vEGuRGC9akaNHQZuNMiyBJE6Eaz4s" },
  { label: "Register model key 0x3b75…fa0c", id: "Gz5YZrrfXiefATMSaxMr4ieK6hHMpXrXqCPPSEaB9EoK" },
  { label: "Owner sets the nearai-gateway profile", id: "6xZBpZexBytmrqRi1g6a92Zj3yvKM7FSuYNEt74rv2dp" },
  { label: "Register gateway key 0xb98a…e779", id: "BGkpjQXiZuPGF4aMDLRvJsKMFcSpwKUDCQjkWiB2AqwX" },
  { label: "Set policy template", id: "2PanG3B8K8ou7kXA2XJ7cDxo7vWihQasJor9zwUNo78X" },
  { label: "Add merchant and register it with USDC", id: "2dirjScF9bkUnaTP39VAbfVoaAcFkV6TA24ksG6fRosG" },
];

// Values recorded in docs/deployments.md, shown when the live RPC is unreachable.
export const SNAPSHOT = {
  caps: { per_payment: "60000000", per_day: "100000000", approval_threshold: "10000000" },
  agent_key: "ed25519:CcSomis7wyQDzAaSuaLiwmyVqud7G8Z8UUFcwM7zGTS7",
  merchant_cap: "60000000",
  usdc_balance: "944000000",
  date: "2026-11-07",
};
