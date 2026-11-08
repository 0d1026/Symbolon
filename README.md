# Symbolon

An AI agent can spend from this wallet only within the owner's limits, only when an AI model approved the payment, and only after the blockchain itself checked that the model's signing key is held by genuine Intel secure hardware running software the owner approved.

Symbolon is a NEAR contract wallet for AI agents. It pays a merchant in USDC only when all of these hold:

1. The merchant signed the invoice, and the merchant is on the owner's allowlist.
2. A NEAR AI model approved that exact invoice. The contract rebuilds the request the model saw from the owner's template, a single use nonce and the invoice, so an approval for any other request is refused.
3. The model's signing key was registered on chain through NEAR One's Intel TDX verifier, with a fresh nonce and measurements the owner allowlisted.
4. The amount fits the merchant cap, the per payment cap and the daily cap. Above the approval threshold, the payment waits for the owner.

Tracks: AI Security & Defense, Agent Economy. Network: NEAR testnet.

More detail: [design](docs/design.md) (terms, every check, formats, contract interface, full threat model with tests), [build and deploy](docs/operate.md). Live evidence: [deployments](docs/deployments.md), [attacks](docs/attacks-testnet.md), [HTTP 402 agent and merchant](docs/agent-merchant.md).

## Problem

NEAR AI Cloud signs every response with `{model_id}:{sha256(request)}:{sha256(response)}`. That signature alone authorizes nothing:

- Every customer of a model receives signatures from the same key. NEAR AI's documentation: "Instances of the same model share one signing key." Anyone can obtain a genuine `approve: true` by sending their own prompt.
- A contract that accepts signatures must decide which key to trust. If the owner registers that key after an off chain check, the chain trusts the owner, not the hardware.

Agents that hold money are attacked through the model path. A study of 428 LLM routers ([arXiv 2604.08407](https://arxiv.org/html/2604.08407v1)) found 9 injecting malicious code, 17 touching planted AWS credentials and 1 draining ETH from a planted key. A prompt injection made a Grok linked trading agent transfer about $150K to $200K in tokens ([AIID 1556](https://incidentdatabase.ai/cite/1556/)).

## How it works

```mermaid
flowchart LR
    Owner([Owner]) -->|policy, caps, merchants, measurements| Wallet
    Agent([AI agent]) -->|request_nonce, pay<br/>function call key| Wallet
    Agent -->|policy request with nonce| NearAI[NEAR AI Cloud<br/>TEE model]
    NearAI -->|signed decision| Agent
    Relayer([Anyone]) -->|request_attestation_nonce<br/>register_attested| Wallet
    Relayer -->|attestation report for nonce| NearAI
    Wallet[Symbolon wallet<br/>v2.symbolon.testnet] -->|verify_quote| Verifier[NEAR One TDX verifier<br/>locked, mainnet code]
    Wallet -->|ft_transfer| USDC[USDC NEP-141]
    USDC --> Merchant([Merchant])
    Merchant -->|HTTP 402 + signed invoice| Agent
```

The agent never holds a key that can move funds by itself. It holds a function call key limited to `request_nonce` and `pay` on the wallet.

1. **Register the model key.** Anyone asks the wallet for a nonce, fetches a NEAR AI attestation report for that nonce and submits the Intel quote. The wallet sends the quote to NEAR One's verifier, then checks that the report binds the signing address and the nonce and that its measurements are on the owner's allowlist. The key stays valid for an owner set lifetime, 30 days on testnet.
2. **Get an invoice.** The agent requests a paid resource and receives HTTP 402 with an invoice signed by the merchant.
3. **Ask the model.** The agent gets a nonce for that invoice from the wallet and sends the owner's policy request, with the nonce and the invoice in it, to NEAR AI. NEAR AI returns the decision signed inside the model's TEE.
4. **Pay.** The agent calls `pay`. The wallet checks the merchant's signature, rebuilds the request, recovers the signer, requires an attested key and `approve: true` for this invoice, applies the caps, then transfers USDC or holds the payment for the owner. The merchant reads the transaction on chain and serves the data.

Every check and byte format is in [docs/design.md](docs/design.md).

## Verify

No keys or accounts needed. Requires `rustup` (the pinned Rust 1.95.0 installs from `rust-toolchain.toml`), `curl`, `python3` and network access. The tests take about 3 minutes on a machine with warm caches. A fresh clone first compiles cargo-near and the dependencies and downloads near-sandbox.

1. Install the build tool and build every contract.

   ```
   git clone https://github.com/0d1026/Symbolon.git
   cd Symbolon
   cargo install cargo-near@0.23.0 --locked
   ./scripts/build.sh
   ```

   See four wasm files: `target/near/symbolon.wasm` (production), `target/near/test/symbolon.wasm` (sandbox nonce hook), `target/near/mock/mock_verifier.wasm`, `target/near/usdc/mock_usdc.wasm`.

2. Run the tests.

   ```
   cd contract
   RUST_TEST_THREADS=3 cargo test
   ```

   See 56 tests pass: 6 unit, 25 registry, 1 migration, 4 mock verifier, 11 payment and 9 payment ownership. The registry and payment tests run NEAR One's verifier at the exact code deployed on mainnet (code hash `6RHv9Er2kDegVjCDcHaBvpbgjmgq5nAHodyBiHC4gZpa`) against real NEAR AI quotes and real signed NEAR AI decisions captured on 2026-11-07. The captured Intel collateral is valid until 2026-12-06.

3. Check the live testnet wallet. The `args_base64` value is `{"address":"0x3b753b4406613c5e70ae640508632b600424fa0c","profile":"z-ai/glm-5.3-flash"}`.

   ```
   curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"v2.symbolon.testnet","method_name":"is_key_valid","args_base64":"eyJhZGRyZXNzIjoiMHgzYjc1M2I0NDA2NjEzYzVlNzBhZTY0MDUwODYzMmI2MDA0MjRmYTBjIiwicHJvZmlsZSI6InotYWkvZ2xtLTUuMy1mbGFzaCJ9"}}' | python3 -c "import sys,json;print(bytes(json.load(sys.stdin)['result']['result']).decode())"
   ```

   See `true`: the NEAR AI model key is registered through the verifier.

4. Check the verifier copy is the mainnet code and locked.

   ```
   curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"tee-verifier.symbolon.testnet"}}'
   curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"tee-verifier.symbolon.testnet"}}'
   ```

   See `code_hash` `6RHv9Er2kDegVjCDcHaBvpbgjmgq5nAHodyBiHC4gZpa` and an empty `keys` list.

## Live proof on testnet

| Account | Role |
| --- | --- |
| `v2.symbolon.testnet` | Symbolon wallet, production build |
| `tee-verifier.symbolon.testnet` | NEAR One TDX verifier, mainnet code, locked |
| `symbolon-usdc.testnet` | Mock USDC, NEP-141, 6 decimals |
| `symbolon-merchant.testnet` | Merchant |
| `symbolon.testnet` | Owner |

NEAR One's verifier is `tee-verifier-2026-08-04.near` on mainnet and has no testnet deployment under that name, so testnet uses a locked copy with the identical code hash.

| Event | Transaction |
| --- | --- |
| Wallet upgraded in place, `migrate` in the same transaction, state unchanged | `7aaxykzmYNbipm3hczGenfn9J1VA8ue5hruhgrtf8SrH` |
| Model key `0x3b75…fa0c` registered through the verifier, valid to 2026-12-08 | `4wi6DGRzTxii67rrXiU7944JekDeuySVVm5Lj1VBoxbz` |
| Gateway key `0xb98a…e779` registered through the verifier, valid to 2026-12-08 | `LxLKsMgno5hXMF3kePZXBeesuQbr4NcqS8YbcbqKT7a` |
| Payment, 2 USDC | `BmjpZZ6iXAxK9KvX4fxTxK9YNE1ovxUumogGhe3N7YMc` |
| Forged approval refused | `4K3FyWkTVmePfbVo7NLgAN7HCDCYXr6xTk9LchThjYNB` |
| Prompt injected payment to attacker refused | `9KPhvQXEmPe7peVXCGaehgKaqhwStdgwjEhrRcyGNduF` |
| Held 50 USDC payment approved by owner | `3MHZRQvwBwiEFxVLStEYkdRsriwJ7EqhKSuTJY8cZBNF` |
| HTTP 402 purchase | `2kj5MfBXPovzF39nCWQqxRNJ7ESc7QPxGSG2rWNmhox5` |

Full tables: [deployments](docs/deployments.md), [attacks](docs/attacks-testnet.md), [agent and merchant](docs/agent-merchant.md). Open a transaction at `https://testnet.nearblocks.io/txns/<id>`.

## Threat model

| Attack | Stopped by | Live transaction |
| --- | --- | --- |
| Forged decision: genuine `approve: true` from the attacker's own prompt, signed by the attested key | rebuilt request hash differs | `4K3FyWkTVmePfbVo7NLgAN7HCDCYXr6xTk9LchThjYNB` |
| Router edits the response | response hash differs | `26W1KmiTaeo9RumXewB7eqriB9MhyGjvFwnZx1PUSNWx` |
| Router edits the request | request hash differs | covered by the forged decision |
| Replay | single use nonce; settled invoices | `DWiHW6Apmc222Pw7YV764udfmXZAmVCYYyiGJQ6kycLo` |
| Key not attested, revoked or registered with unlisted measurements | on chain verifier and registry checks | |
| Stolen agent key | access key rules, merchant allowlist, merchant signature | `8vGgRBjWNoEhJLPaDcGm5tGWuyEDQDtbat1bCjVfmtS5` |
| Prompt injected agent pays an attacker | merchant allowlist | `9KPhvQXEmPe7peVXCGaehgKaqhwStdgwjEhrRcyGNduF` |
| Prompt injected agent buys outside the mandate | policy model refusal | `5TebcEdYhoKzoWkZFKC6vAFnruvPwZxFgzHSbpchzseP` |
| Large payment | approval threshold, owner decides | `AVvnPYm478TALVDzczJnLWHzvwVi5U5puFEa5ZTnHQ5a` |
| Failed transfer | `on_paid` rolls back pending and settled state | |
| Upgrade that cannot read the state | `migrate` runs in the same receipt as the deploy | `7aaxykzmYNbipm3hczGenfn9J1VA8ue5hruhgrtf8SrH` |

The sandbox test for each row is listed in [docs/design.md](docs/design.md#threat-model).

## Agent key limits

The agent holds one NEAR function call access key on the wallet account, installed by the owner with `set_agent_key`.

| Property | Value | Enforced by |
| --- | --- | --- |
| Receiver | the wallet only | NEAR protocol: `ReceiverMismatch` |
| Methods | `request_nonce`, `pay` | NEAR protocol: `MethodNameMismatch` |
| Deposit | none | NEAR protocol: `DepositWithFunctionCall` |
| Gas allowance | 1 NEAR on testnet | NEAR protocol |
| Caller check | `pay` and `request_nonce` require predecessor = wallet and signer key = registered agent key | contract |

A stolen agent key can request nonces (at most 32 live) and submit payments, but a payment only succeeds for an invoice signed by an allowlisted merchant, approved by an attested model over the owner's template, and within the caps. It can also spend its own gas allowance on failing calls. When the allowance is spent the key stops working; the owner installs a new key with `set_agent_key`, which also deletes the old one. The owner can `freeze` the wallet at any time.

Testnet note: `v2.symbolon.testnet` still has its deployment full access key, used for the in place upgrade because the first deployed build had no `migrate`. A production wallet deletes it after deployment and upgrades only through the owner's `update_contract`.

## Limits and trust assumptions

- **Gateway.** NEAR AI's gateway hashes the client's request bytes and passes that hash to the model TEE, which signs it. The model TEE does not recompute it. The gateway key can be registered under its own profile (done on testnet), but the contract does not check a gateway signature per payment.
- **Shared model key.** One key serves every instance of a model. Registration proves the key lives in at least one enclave with allowlisted measurements, not that every instance holding it does.
- **Not checked on chain.** NVIDIA GPU evidence and RTMR3 event log replay. The configuration is bound through `mr_config_id`.
- **Measurement policy.** NEAR AI publishes no reference values. The owner must read the `app_compose` behind a compose hash before allowlisting it. On testnet the owner allowlisted the measurements from the live attestation report.
- **Collateral age.** The verifier checks Intel collateral against block time. Test fixtures expire on 2026-12-06 and are recaptured with `scripts/capture_attestation.py`.
- **USDC.** Testnet uses a mock NEP-141 token with 6 decimals. Mainnet USDC is Circle's contract.
- **Policy model.** A refused invoice cannot be submitted again, but a compromised agent can ask the model several times off chain with one nonce and submit only an approving answer, or ask the merchant for a new invoice. Each payment is still bounded by the merchant allowlist and the caps.
- **Merchant memo.** An allowlisted merchant can place text in its own invoice memo. The character set and 64 byte limit keep it from breaking the request JSON; the caps bound the loss.
- **Fooled agent.** An agent fooled into requesting a valid invoice from an allowlisted merchant for an allowed item can spend up to the caps.
- **Held payments.** The owner can approve a held payment after removing its merchant or lowering the caps; `approve_held` rechecks only the freeze and the daily budget. Held payments do not expire.
- **Final refusals.** A refusal of the signature or the decision blocks that invoice even when the model was not the cause, for example a router that edited the response or a key that had just expired. The merchant then issues a new invoice.
- **Daily cap.** The daily window is the UTC day, so up to twice `per_day` can be spent across midnight.

## NEAR features used

| Feature | Use |
| --- | --- |
| NEAR One TDX attestation verifier (`verify_quote`) | on chain Intel DCAP verification of NEAR AI enclaves |
| Function call access keys | the agent key, limited to two methods with no deposits |
| `env::ecrecover`, `env::keccak256_array` | EIP-191 recovery of NEAR AI ECDSA signatures (`unstable` feature) |
| `env::ed25519_verify` | merchant invoice signatures |
| `env::sha256_array` | request and response hashes, compose hash, nonces |
| Promises and callbacks | `verify_quote` then `on_attestation_verified`; `ft_transfer` then `on_paid` |
| NEP-141 | USDC transfers and storage registration |
| NEP-297 | contract events |
| NEAR AI Cloud | TEE model inference, `provider_tee` response signatures, attestation reports |

## Repository

| Path | Contents |
| --- | --- |
| `contract/src/lib.rs` | attested key registry |
| `contract/src/pay.rs` | payment path |
| `contract/src/verifier.rs` | borsh types of NEAR One's verifier, matched byte for byte against the deployed contract |
| `contract/tests/` | sandbox tests and fixtures: verifier wasm, attestation reports, signed decisions |
| `mock-verifier/` | sandbox only verifier that returns a preset answer |
| `mock-usdc/` | NEP-141 USDC stand in for sandbox and testnet |
| `app/` | TypeScript agent, merchant and checks |
| `scripts/` | build, capture, registration, live payment and attack scripts |
| `spec/` | owner policy templates for sandbox and testnet |
| `docs/design.md` | terms, every check, formats, contract interface, full threat model |
| `docs/operate.md` | tools, live scripts, deployment |
| `docs/` | deployments, attacks, agent and merchant evidence |

## Credits and license

Built during NEAR HACKATHON, 2026-11-05 onward. Libraries: near-sdk, near-contract-standards, near-workspaces, cargo-near, near-api-js, borsh, hex, sha2, tokio, tsx and TypeScript; Phala's dcap-qvl in the attestation capture script; NEAR One's `tee-verifier` contract, used unmodified. Code and documentation were written with AI coding assistance (Claude Code) and reviewed by the team.

Apache 2.0. See [LICENSE](LICENSE).
