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

### Not deployed yet

- The payment path that accepts only signatures from registered keys.
- A mock USDC token for testnet payments.
- The gateway key, whose profile is set but which has not been registered.
