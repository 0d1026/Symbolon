# Benchmark

Sandbox run: real NEAR One verifier code, the real attested NEAR AI key and the NEAR AI decisions captured on 2026-11-07, mock USDC. No keys and no network calls to NEAR AI. Each sample runs in a fresh sandbox, because a paid or refused invoice can never reach the same wallet again.

Rerun: `./scripts/build.sh && cd contract && cargo test --test benchmark -- --ignored --nocapture`. Size: `BENCH_LEGIT=100 BENCH_ATTACKS=100`.

## Summary

- Legitimate payments paid: 20/20
- Attacks blocked: 18/18; leaked: 0
- Large payments held for the owner (not counted as blocked): 2/2
- Wall time: 142 s with 3 sandboxes in parallel

## Per kind

| Kind | Runs | Paid | Held | Blocked | Leaked | Rate | pay() gas total, Tgas (mean) | wallet receipts, Tgas (mean) | request_nonce ms p50 | pay ms p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| legit | 20 | 20 | 0 | 0 | 0 | 100% paid | 8.46 | 6.49 | 637 | 507 / 520 |
| forged_decision | 3 | 0 | 0 | 3 | 0 | 100% blocked | 3.53 | 3.22 | 625 | 255 / 259 |
| tampered_response | 3 | 0 | 0 | 3 | 0 | 100% blocked | 3.53 | 3.22 | 637 | 255 / 259 |
| replay | 3 | 0 | 0 | 3 | 0 | 100% blocked | 2.23 | 1.92 | 0 | 247 / 250 |
| stolen_key | 3 | 0 | 0 | 3 | 0 | 100% blocked | 0.00 | 0.00 | 0 | 2436 / 2494 |
| injection_pay_attacker | 3 | 0 | 0 | 3 | 0 | 100% blocked | 1.88 | 1.57 | 251 | 252 / 255 |
| injection_outside_mandate | 3 | 0 | 0 | 3 | 0 | 100% blocked | 3.78 | 3.47 | 625 | 257 / 259 |
| held_large_payment | 2 | 0 | 2 | 0 | 0 | 100% held | 4.10 | 3.79 | 631 | 261 / 261 |

Gas is `total_gas_burnt` of the measured transaction, which includes the USDC transfer and the `on_paid` callback on paid runs; "wallet receipts" counts only receipts executed on the wallet account. `stolen_key` is rejected by the NEAR protocol before execution (`MethodNameMismatch`), so it burns no contract gas. `replay` resubmits a paid invoice without a new nonce; only the resubmission is measured. Latency is sandbox time (a local node with fast blocks), not testnet time, and does not include the NEAR AI call: the decisions are captured.

| Kind | What happened (first run) |
| --- | --- |
| legit | `paid` |
| forged_decision | `refused: decision not signed by an attested model key for this request` |
| tampered_response | `refused: decision not signed by an attested model key for this request` |
| replay | `tx failed: no payment nonce for this invoice` |
| stolen_key | `tx rejected: MethodNameMismatch { method_name: ` |
| injection_pay_attacker | `tx failed: Smart contract panicked: payee is not an allowlisted merchant` |
| injection_outside_mandate | `refused: model did not approve this invoice` |
| held_large_payment | `held:0` |
