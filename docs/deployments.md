# Deployments

## Testnet (2026-11-07)

| Account | Role | Notes |
| --- | --- | --- |
| `symbolon.testnet` | Owner | Sets measurement profiles. |
| `tee-verifier.symbolon.testnet` | Our copy of NEAR One's TDX verifier | Code hash `6RHv9Er2kDegVjCDcHaBvpbgjmgq5nAHodyBiHC4gZpa`, identical to `tee-verifier-2026-08-04.near` on mainnet. Locked: 0 access keys. |
| `v1.symbolon.testnet` | Symbolon registry, production build with no test features | Initialised with `new(owner=symbolon.testnet, verifier=tee-verifier.symbolon.testnet, key_ttl_ms=604800000)`, a 7 day key lifetime. |

### Why our own verifier copy

On mainnet, NEAR One's verifier is `tee-verifier-2026-08-04.near`. On testnet we checked `tee-verifier-2026-08-04.testnet`, which does not exist. We also found `tee-verifier.testnet`, which is locked and verifies NEAR AI quotes. But it has a different code hash (`3ft8XBUuVinUurECNiHhPmu1qKzeDvELF8ymhBPdRJkz`), and nothing in the `near/mpc` repository references it. So we deployed the exact mainnet code to our own account and locked it. Anyone can confirm both facts with `view_account` and `view_access_key_list`.

### Where the allowlist came from

The owner set both profiles from the measurements in the same live attestation report used for registration. A production owner should first review the `app_compose` file behind each compose hash, including its container image digests, before allowlisting it.

### Live registration

| Step | Transaction |
| --- | --- |
| Deploy verifier | `hXsUMNqaN4KfcK3H3YqWvrjnEW3VTmwfAyM4QCwUX4c` |
| Lock verifier by deleting its only key | `2ovS3Rhs5VAUQtcCr4uY6eRxqVjP4XiTR8VUz37zXyno` |
| Deploy and initialise Symbolon | `6BQSC1FG8kTR8n841z7EDHQgDc5MBNpvoa2jyXbeRY3x` |
| Contract issues nonce `66c640f3f4d9c576384aca678684e1880312a58878cb1ef703b934f6af83fcfc` | `3XDNV6pehdYFSXpj3kAqpmmUafhLuyDn81LfoQ5ttvhk` |
| Owner sets the `z-ai/glm-5.3-flash` profile | `3Yz1mXLJy4s5gyvLXWMs5KpBKTNxYpqcmG4fkxNyEvyv` |
| Owner sets the `nearai-gateway` profile | `HbGXthPBr5nrBd6GJL7Kr6rKQBrmvxagdUS8ouz63UMq` |
| Register model key `0x3b753b4406613c5e70ae640508632b600424fa0c` through the verifier | `7yQZLSy3XKan4gvC5s2om9m8uPKZBurjCAjaLzwT4tvr` |

Open any transaction at `https://explorer.testnet.near.org/transactions/<transaction id>`, the link format near-cli prints.

After the last step, `is_key_valid` for address `0x3b753b4406613c5e70ae640508632b600424fa0c` and profile `z-ai/glm-5.3-flash` returns `true`.

`v1` holds the registry only. The payment path is deployed in `v2` below.

## Testnet v2: registry and payments (2026-11-07)

| Account | Role | Notes |
| --- | --- | --- |
| `v2.symbolon.testnet` | Symbolon wallet, production build | Initialised with `new(owner=symbolon.testnet, verifier=tee-verifier.symbolon.testnet, key_ttl_ms=604800000, usdc=symbolon-usdc.testnet)`. |
| `symbolon-usdc.testnet` | Mock USDC (NEP-141, 6 decimals) | `mock-usdc/` in this repo. 1,000,000 USDC minted to `symbolon.testnet`. Testnet has no Circle USDC. |
| `symbolon-merchant.testnet` | Demo merchant | Invoice key `ba7af894868c7e4792d2266d3b77da066d98173a6d7099ffe5f127f6d1f7a010`. Registered with USDC. Cap 60 USDC. |
| Agent key `ed25519:CcSomis7wyQDzAaSuaLiwmyVqud7G8Z8UUFcwM7zGTS7` on `v2.symbolon.testnet` | Agent | Function-call key limited to `request_nonce` and `pay`, 1 NEAR gas allowance. |

Caps: approval threshold 10 USDC, 60 USDC per payment, 100 USDC per day. Policy template: `spec/policy-testnet.json`.

### Setup

| Step | Transaction |
| --- | --- |
| Deploy mock USDC | `919EGCRSyitwMzMu99HVmdCUrr8QmTUPH7tGve1KLpWB` |
| Create `v2.symbolon.testnet` | `D8d16HyyC8z5vtDscUxY9gDgYgFtiDAaVsfpMX1kYU2r` |
| Deploy and initialise Symbolon v2 | `BjDCjfLakEybxhdy1mQjhhvdB4zjCmPvyugUpmpUDGpG` |
| Owner sets the `z-ai/glm-5.3-flash` profile | `BVbevG4pucj7B53vEGuRGC9akaNHQZuNMiyBJE6Eaz4s` |
| Register model key `0x3b753b4406613c5e70ae640508632b600424fa0c` with nonce `c3e7914a645be1f7536af6b48749aef70317eb2f0166de689edb428cedf44ef1` | `Gz5YZrrfXiefATMSaxMr4ieK6hHMpXrXqCPPSEaB9EoK` |
| Owner sets the `nearai-gateway` profile | `6xZBpZexBytmrqRi1g6a92Zj3yvKM7FSuYNEt74rv2dp` |
| Register gateway key `0xb98a789cdc4817275f5155593ba73ef2a957e779` with nonce `6b3beb1a9526991e1ba1e3fb40b3a6b4e534ff6886ade25ff65e3e6787f02600` | `BGkpjQXiZuPGF4aMDLRvJsKMFcSpwKUDCQjkWiB2AqwX` |
| Set policy template | `2PanG3B8K8ou7kXA2XJ7cDxo7vWihQasJor9zwUNo78X` |
| Add merchant and register it with USDC | `2dirjScF9bkUnaTP39VAbfVoaAcFkV6TA24ksG6fRosG` |
| Set caps | `NfCT6EqFY4sBscPUQNpWPq2cs4rtduQogfmBc9YnKza` |
| Register the wallet with USDC | `7Wcr8tCYa4BaF7TdZZvB7yqx76dAc6NFDzHer3nwkiGG` |
| Fund the wallet with 1,000 USDC | `F4pMUJNr9wqQZibzuQjd2NHYmqtgWNrWXhUkwmSjXoUc` |
| Install the agent key | `HnDfYdzXBinS4Kf1F1hyL8UddeTi3Tdh7ZctkCUmtRRp` |

### Live payments

Both ran with `scripts/live_pay.mjs`, signed by the agent key. NEAR AI returned a `provider_tee` signature from the attested model key each time.

| Payment | Invoice | `request_nonce` | `pay` | Result |
| --- | --- | --- | --- | --- |
| 1 | `70caa7d2ecb3a6c4`, 2 USDC, "market data feed" | not captured | not captured | `paid` |
| 2 | `9db921e9c09f35ef`, 2 USDC, "market data feed" | `HbVUa1LUDPAe7Lirhu85SkXo961HSYt1mxph2MJ7Qdjv` | `BmjpZZ6iXAxK9KvX4fxTxK9YNE1ovxUumogGhe3N7YMc` | `paid` |

Payment 1 ran before the script read near-cli's stderr, so its transaction IDs were not printed. Its effect is visible in the balances.

Payment 2 emitted `payment_sent` (request hash `f125fa072f33ea378a5b91bc643584d8f3a090de8469c3da90bd9c552178c611`, response hash `50ff8e0713a87d92a094ff6a3ef1158e28a2e72c926a28dab5c0b7eaa44a1a4e`), the token's `ft_transfer`, and `payment_completed`.

USDC balances after both payments, read with `ft_balance_of`:

| Account | Balance (base units) |
| --- | --- |
| `symbolon-merchant.testnet` | 4,000,000 (4 USDC) |
| `v2.symbolon.testnet` | 996,000,000 (996 USDC, from 1,000) |
