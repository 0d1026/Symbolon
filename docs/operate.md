# Build, test and deploy

Tools, live scripts and the deployment steps. Start with the [README](../README.md).

| Tool | Version |
| --- | --- |
| Rust | 1.95.0, `wasm32-unknown-unknown` |
| near-sdk, near-contract-standards | 5.30.1 |
| cargo-near | 0.23.0 |
| near-workspaces | 0.24.0 |
| near-cli-rs | 0.31.1 |
| near-api-js | 7.4.0 |
| Node.js | 20 |

```
./scripts/build.sh
cd contract && RUST_TEST_THREADS=3 cargo test
```

Live scripts read keys from outside the repository: `~/.nearai.env` holds `NEAR_AI_CLOUD_API_KEY`, and `~/.symbolon/` holds the agent access key and invoice signing keys.

| Script | Purpose |
| --- | --- |
| `scripts/capture_attestation.py <out.json> [nonce]` | fetch a NEAR AI attestation report and Intel collateral for a nonce |
| `scripts/register_args.py <capture.json> model\|gateway profile\|register <profile>` | build `set_profile` JSON or `register_attested` borsh args |
| `scripts/capture_decisions.mjs <out.json>` | capture signed NEAR AI decisions for the sandbox tests |
| `scripts/live_pay.mjs <amount> "<memo>"` | one live payment on testnet |
| `scripts/attacks.mjs <attack\|all>` | live attacks on testnet, results in `docs/attacks-testnet.json` |
| `app/` | TypeScript agent, merchant and merchant checks; see [agent and merchant](agent-merchant.md) |

Deploying a wallet, as done for `v2.symbolon.testnet`:

```
near contract deploy <wallet> use-file target/near/symbolon.wasm with-init-call new json-args '{"owner":"<owner>","verifier":"<verifier>","key_ttl_ms":2592000000,"usdc":"<usdc>"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
```

Then, as the owner: `set_profile`, a registration through `request_attestation_nonce` and `register_attested`, `set_policy_template`, `add_merchant` with a USDC storage deposit and 50 Tgas, `set_caps`, `set_agent_key`, and a USDC `storage_deposit` plus `ft_transfer` to fund the wallet. Every transaction is listed in [deployments](deployments.md).
