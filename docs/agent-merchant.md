# Agent and merchant over HTTP 402

A merchant sells data behind HTTP 402. An agent pays through the Symbolon wallet and gets the data only after the merchant sees the USDC transfer on testnet.

Code: `app/src/merchant.ts`, `app/src/agent.ts`, `app/src/lib.ts`, `app/src/checks.ts`.

## Run it

```
cd app
npm install
npm run merchant
npx tsx src/agent.ts buy http://localhost:4020/data/market-feed
npx tsx src/checks.ts http://localhost:4020/data/market-feed ../docs/agent-merchant-checks.json
```

Needs the agent key and merchant invoice key in `~/.symbolon` and a NEAR AI key in `~/.nearai.env`. See `deployments.md` for the accounts.

## Flow

1. Agent requests `GET /data/market-feed`.
2. Merchant answers `402` with a `PAYMENT-REQUIRED` header: an x402 v2 `PaymentRequired` object whose only option carries a fresh invoice signed by the merchant's ed25519 key.
3. Agent calls `request_nonce` on `v2.symbolon.testnet` with its function-call key.
4. Agent sends the owner's policy request with that nonce and invoice to NEAR AI and gets a `provider_tee` signed decision. It checks the signed hashes against the exact bytes before spending gas.
5. Agent calls `pay`. The wallet runs every check and transfers USDC.
6. Agent retries the request with a `PAYMENT-SIGNATURE` header holding the transaction hash.
7. Merchant reads that transaction from testnet RPC and requires all of:
   - the transaction is a `pay` call signed by and sent to the payer's wallet;
   - `pay` returned `paid`;
   - the USDC contract emitted `ft_transfer` from the wallet to the merchant, for the invoice amount, with memo `symbolon invoice <id>`;
   - the invoice was issued by this merchant and not served before.
8. Merchant answers `200` with the data and a `PAYMENT-RESPONSE` settlement header.

## x402 mapping

| x402 v2 field | Value |
| --- | --- |
| `scheme` | `symbolon-attested` |
| `network` | `near:testnet` |
| `asset` | `symbolon-usdc.testnet` |
| `payTo` | `symbolon-merchant.testnet` |
| `extra.paymentFlow` | `upfront`: the client pays before the resource runs |
| `extra.symbolon` | the signed invoice and the wallet account |
| `payload` | `{ transaction, payer }` |

This is a custom scheme. It follows the spec's headers and the `upfront` payment flow, but it is not the merged NEAR `exact` scheme, which needs a full-access key on the paying account. No facilitator is involved: the merchant verifies the transaction on chain itself.

## Live run on testnet, 2026-11-08

| Purchase | `request_nonce` | `pay` | Merchant answer |
| --- | --- | --- | --- |
| First purchase | `DKjyKEPTADAyQakE4iDCSRAhKnGC1R5fbHTgYX9u9rgR` | `6tNtW67eGhzGbqTnF4T7CeLCvWY88guenuVjrZxnAnJm` | `200` with settlement |
| Purchase used by the checks | `CtoVbBkaKF7iLkFGR4rPG4SNxYeTmwrpiCcExwXq3Qxg` | `2kj5MfBXPovzF39nCWQqxRNJ7ESc7QPxGSG2rWNmhox5` | `200` with settlement |
| Purchase used by the concurrency check | `5XnwXzB8jdnePFQDwKMJ2pE7DispYooUerMusW1d99Go` | `DigPVhdatwdoCkNEwVaw8AW3owrcPd7fsocbRCUL2XQM` | one `200`, one `402` |

Each purchase paid 2 USDC. NEAR AI signed both decisions with the attested key `0x3b753b4406613c5e70ae640508632b600424fa0c`.

## Merchant refusals

Run by `src/checks.ts` against the live merchant. Raw result: `agent-merchant-checks.json`.

| Attempt | Merchant answer |
| --- | --- |
| No payment proof | `402`: PAYMENT-SIGNATURE header is required |
| Reuse the paid proof | `402`: invoice already served |
| Claim the paid transaction for a new invoice | `402`: no USDC transfer to this merchant for this invoice |
| Proof pointing at a refused `pay` (`4K3FyWkTVmePfbVo7NLgAN7HCDCYXr6xTk9LchThjYNB`) | `402`: wallet did not pay: refused: decision not signed by an attested model key for this request |
| Proof pointing at a `request_nonce` transaction | `402`: transaction is not a pay call on the payer's wallet |
| The same fresh proof sent twice at the same moment | one `200`; the other `402`: invoice payment is already being verified |

## Limits

- The agent pays before the merchant serves. If the merchant is down after `pay` succeeds, the agent has paid and has no data. The transaction hash stays valid proof, so the agent can retry until the invoice expires.
- Invoices expire after 10 minutes. The merchant holds at most 1,000 unserved invoices and answers `503` above that. In a local run of 1,001 unpaid requests, every request past the limit got `503`.
- The merchant keeps issued invoices in memory. A restart forgets them, so a proof for an invoice issued before the restart is refused.
- The data served is a static sample, marked `"sample": true`.
