export type Tx = { label: string; id?: string; result: string; ok?: boolean };

export type Attack = {
  slug: string;
  n: string;
  name: string;
  did: string;
  stopped: string;
  moved: string;
  story: string[];
  txs: Tx[];
  hashes?: { attacker: string; owner: string };
};

export const ATTACKS: Attack[] = [
  {
    slug: "forged-approval",
    n: "01",
    name: "Forged approval",
    did: "Got a genuine approve: true, signed by the attested NEAR AI key, from their own prompt.",
    stopped: "The contract rebuilt the owner's request. The signed hash did not match.",
    moved: "None",
    story: [
      "The attacker asked NEAR AI, with their own prompt, to approve a gift card invoice the owner forbids. The signature is real, but it covers a different request.",
    ],
    hashes: {
      attacker: "35a0f89501c11821a074edf56bcf57bf42e18e016f54beb86e7cfb80fc333319",
      owner: "be4ea60f72fec8d0665a28d4eb71622a9608edb09f9c30fdf704c13667d85e4b",
    },
    txs: [
      { label: "request_nonce", id: "DACRz1ZvrJwJKcG549d76HwmGE7uMPQX1u2svxfZHThS", result: "nonce issued", ok: true },
      { label: "pay with the attacker's approval", id: "4K3FyWkTVmePfbVo7NLgAN7HCDCYXr6xTk9LchThjYNB", result: "refused: decision not signed by an attested model key for this request" },
    ],
  },
  {
    slug: "tampered-response",
    n: "02",
    name: "Tampered response",
    did: "Changed the approved amount from 2 to 9 USDC inside the signed response.",
    stopped: "The response hash no longer matched the signature.",
    moved: "None",
    story: [
      "A router changed the approved amount from 2 to 9 USDC. One changed character gives a different hash, so the signature no longer fits.",
    ],
    txs: [
      { label: "request_nonce", id: "9v3KELZTtfZrbvHuXh5X3b1dStqzUn6XJ9kTJNEUE6Wz", result: "nonce issued", ok: true },
      { label: "pay with the edited response", id: "26W1KmiTaeo9RumXewB7eqriB9MhyGjvFwnZx1PUSNWx", result: "refused: decision not signed by an attested model key for this request" },
    ],
  },
  {
    slug: "replay",
    n: "03",
    name: "Replay",
    did: "Resubmitted a paid invoice, then reused its approval under a fresh nonce.",
    stopped: "Nonces are single use. A new nonce changes the request.",
    moved: "Only the honest 2 USDC",
    story: [
      "After one honest payment, the attacker sent the same call again, then tried the old approval with a new nonce. A used nonce is gone, and a new one changes the request.",
    ],
    txs: [
      { label: "request_nonce", id: "6teE9TWqyVHt8Nt6ThQVDrgwuLyLgqDbcm2yShaRUwjS", result: "nonce issued", ok: true },
      { label: "honest payment of 2 USDC", id: "8NnvEn7VW2rBoHL2ms4mrfHx357KxTWVwzvnL8qYfnku", result: "paid", ok: true },
      { label: "same arguments again", id: "DWiHW6Apmc222Pw7YV764udfmXZAmVCYYyiGJQ6kycLo", result: "failed: no payment nonce for this invoice" },
      { label: "request_nonce again", id: "EqPuembstT87z4nWhxzzs7h7ox48aDYYAYvsrhf8Lo61", result: "new nonce issued", ok: true },
      { label: "old approval, new nonce", id: "6YAG9mDr48AFB1PtYFg7rHf6GCoYDjWYtiPJRGRLpRfF", result: "refused: decision not signed by an attested model key for this request" },
    ],
  },
  {
    slug: "stolen-agent-key",
    n: "04",
    name: "Stolen agent key",
    did: "Used the agent key on owner methods, deposits, the USDC contract and self-made invoices.",
    stopped: "NEAR access key rules first, then the merchant allowlist and invoice signature.",
    moved: "None",
    story: [
      "NEAR rejected the first three calls before they reached the contract. The last two reached it and failed its checks. The key could only burn its own gas.",
    ],
    txs: [
      { label: "call owner method set_caps", result: "InvalidAccessKeyError: MethodNameMismatch" },
      { label: "attach a deposit", result: "InvalidAccessKeyError: DepositWithFunctionCall" },
      { label: "call the USDC contract directly", result: "InvalidAccessKeyError: ReceiverMismatch" },
      { label: "pay to symbolon-attacker.testnet", id: "8vGgRBjWNoEhJLPaDcGm5tGWuyEDQDtbat1bCjVfmtS5", result: "failed: payee is not an allowlisted merchant" },
      { label: "pay an invoice the merchant never signed", id: "2a3Zuie8opr3AV75XYQB9aZvLzBBSai5me467emsvjDw", result: "failed: invoice signature is not the merchant's" },
    ],
  },
  {
    slug: "prompt-injection",
    n: "05",
    name: "Prompt injection",
    did: "A fooled agent tried to pay the attacker, then to buy gift cards at the real merchant.",
    stopped: "The merchant allowlist, then the policy model's refusal.",
    moved: "None",
    story: [
      "A fooled agent tried to pay the attacker, then to buy gift cards from the real merchant. The allowlist stopped the first. The model refused the second.",
    ],
    txs: [
      { label: "pay 45 USDC to the attacker", id: "9KPhvQXEmPe7peVXCGaehgKaqhwStdgwjEhrRcyGNduF", result: "failed: payee is not an allowlisted merchant" },
      { label: "request_nonce for the gift card invoice", id: "CfKNWq5TEGw39Q8rffHvqqEM76Hih5J9V88WEP58WoaT", result: "nonce issued", ok: true },
      { label: "pay the gift card invoice", id: "5TebcEdYhoKzoWkZFKC6vAFnruvPwZxFgzHSbpchzseP", result: "refused: model did not approve this invoice" },
    ],
  },
  {
    slug: "large-payment-held",
    n: "06",
    name: "Large payment held",
    did: "An approved 50 USDC invoice, above the 10 USDC approval threshold.",
    stopped: "Held until the owner decides. A second held payment was rejected.",
    moved: "Only the approved 50 USDC",
    story: [
      "The payment was valid but above the owner's threshold, so the wallet held it. The owner approved one and rejected the other.",
    ],
    txs: [
      { label: "request_nonce for 50 USDC", id: "FBaDfWwSdfqqgv4ogduAqcp1LeaQwdtF7kye9GtpDypJ", result: "nonce issued", ok: true },
      { label: "pay 50 USDC", id: "AVvnPYm478TALVDzczJnLWHzvwVi5U5puFEa5ZTnHQ5a", result: "held:0", ok: true },
      { label: "owner approve_held(0)", id: "3MHZRQvwBwiEFxVLStEYkdRsriwJ7EqhKSuTJY8cZBNF", result: "paid", ok: true },
      { label: "request_nonce for 15 USDC", id: "Fbn68zqPcQTrjPvM2FB9d4MxifcQtNWgV6vgy5TpCfGY", result: "nonce issued", ok: true },
      { label: "pay 15 USDC", id: "6FNk3quA18uuLRqB7NCGNm5EB8gKZ9HAS4XFbYJqNxAF", result: "held:1", ok: true },
      { label: "owner reject_held(1)", id: "124HCgp9Zxe2yyvKLWrpTVHKdr8PGxacD8SmF1CzbffD", result: "rejected, invoice released", ok: true },
    ],
  },
];

export const txUrl = (id: string) => `https://testnet.nearblocks.io/txns/${id}`;
