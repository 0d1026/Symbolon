#![allow(dead_code)]
//! Shared sandbox setup and helpers for the integration tests.

use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde::Deserialize;
use serde_json::json;
use symbolon::verifier::{Collateral, QuoteBytes};

pub mod pay;

pub const VERIFIER_WASM: &str = "tests/fixtures/tee_verifier_mainnet.wasm";
pub const FIXTURE: &str = "tests/fixtures/attestation_2026-11-07.json";
pub const TEST_WASM: &str = "../target/near/test/symbolon.wasm";
/// Production build: no `test-nonce` feature, exactly what gets deployed.
pub const PROD_WASM: &str = "../target/near/symbolon.wasm";
pub const USDC_WASM: &str = "../target/near/usdc/mock_usdc.wasm";
/// 1,000,000 USDC in base units (6 decimals), minted to the owner.
pub const USDC_SUPPLY: u128 = 1_000_000_000_000;
pub const MODEL: &str = "z-ai/glm-5.3-flash";
pub const GATEWAY: &str = "nearai-gateway";

#[derive(Deserialize, Clone)]
pub struct Fixture {
    pub nonce: String,
    pub candidates: Candidates,
}
#[derive(Deserialize, Clone)]
pub struct Candidates {
    pub model: Candidate,
    pub gateway: Candidate,
}
#[derive(Deserialize, Clone)]
pub struct Candidate {
    pub signing_address: String,
    pub intel_quote: String,
    pub app_compose: String,
    pub collateral: RawCollateral,
    pub measurements: Measurements,
}
#[derive(Deserialize, Clone)]
pub struct RawCollateral {
    pub pck_crl_issuer_chain: String,
    pub root_ca_crl: String,
    pub pck_crl: String,
    pub tcb_info_issuer_chain: String,
    pub tcb_info: String,
    pub tcb_info_signature: String,
    pub qe_identity_issuer_chain: String,
    pub qe_identity: String,
    pub qe_identity_signature: String,
    pub pck_certificate_chain: Option<String>,
}
#[derive(Deserialize, Clone)]
pub struct Measurements {
    pub mr_td: String,
    pub rt_mr0: String,
    pub rt_mr1: String,
    pub rt_mr2: String,
    pub compose_hash: String,
}

impl RawCollateral {
    fn to_borsh(&self) -> Collateral {
        Collateral {
            pck_crl_issuer_chain: self.pck_crl_issuer_chain.clone(),
            root_ca_crl: hex::decode(&self.root_ca_crl).unwrap(),
            pck_crl: hex::decode(&self.pck_crl).unwrap(),
            tcb_info_issuer_chain: self.tcb_info_issuer_chain.clone(),
            tcb_info: self.tcb_info.clone(),
            tcb_info_signature: hex::decode(&self.tcb_info_signature).unwrap(),
            qe_identity_issuer_chain: self.qe_identity_issuer_chain.clone(),
            qe_identity: self.qe_identity.clone(),
            qe_identity_signature: hex::decode(&self.qe_identity_signature).unwrap(),
            pck_certificate_chain: self.pck_certificate_chain.clone(),
        }
    }
}

pub fn profile_json(m: &Measurements) -> serde_json::Value {
    json!({
        "mr_td": [m.mr_td], "rt_mr0": [m.rt_mr0], "rt_mr1": [m.rt_mr1],
        "rt_mr2": [m.rt_mr2], "compose_hashes": [m.compose_hash]
    })
}

pub struct Env {
    pub verifier: Account,
    pub usdc: Contract,
    pub _worker: Worker<near_workspaces::network::Sandbox>,
    pub owner: Account,
    pub relayer: Account,
    pub wallet: Contract,
    pub fx: Fixture,
}

pub async fn setup() -> anyhow::Result<Env> {
    setup_with_verifier(&std::fs::read(VERIFIER_WASM)?).await
}

/// Same as `setup`, but with any verifier code, for example the sandbox mock.
pub async fn setup_with_verifier(verifier_wasm: &[u8]) -> anyhow::Result<Env> {
    setup_with(verifier_wasm, TEST_WASM).await
}

/// Full control: any verifier code and any Symbolon build (test or production).
pub async fn setup_with(verifier_wasm: &[u8], wallet_wasm_path: &str) -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let fx: Fixture = serde_json::from_str(&std::fs::read_to_string(FIXTURE)?)?;

    let verifier = root
        .create_subaccount("verifier")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;
    verifier.deploy(verifier_wasm).await?.into_result()?;

    let owner = root
        .create_subaccount("owner")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;
    let relayer = root
        .create_subaccount("relayer")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;

    let usdc_wasm = std::fs::read(USDC_WASM)
        .map_err(|e| anyhow::anyhow!("{USDC_WASM}: {e}. Run ./scripts/build.sh first"))?;
    let usdc = root
        .create_subaccount("usdc")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?
        .deploy(&usdc_wasm)
        .await?
        .into_result()?;
    usdc.call("new")
        .args_json(json!({"owner_id": owner.id(), "total_supply": USDC_SUPPLY.to_string()}))
        .transact()
        .await?
        .into_result()?;

    let wasm = std::fs::read(wallet_wasm_path)
        .map_err(|e| anyhow::anyhow!("{wallet_wasm_path}: {e}. Run ./scripts/build.sh first"))?;
    let wallet = worker.dev_deploy(&wasm).await?;
    wallet
        .call("new")
        .args_json(json!({
            "owner": owner.id(),
            "verifier": verifier.id(),
            "key_ttl_ms": 7u64 * 24 * 3600 * 1000,
            "usdc": usdc.id(),
        }))
        .transact()
        .await?
        .into_result()?;

    for (name, c) in [
        (MODEL, &fx.candidates.model),
        (GATEWAY, &fx.candidates.gateway),
    ] {
        owner
            .call(wallet.id(), "set_profile")
            .args_json(json!({"profile": name, "measurements": profile_json(&c.measurements)}))
            .transact()
            .await?
            .into_result()?;
    }
    Ok(Env {
        verifier,
        usdc,
        _worker: worker,
        owner,
        relayer,
        wallet,
        fx,
    })
}

/// Owner pins the next nonce to the one in the captured report, then the
/// relayer requests it exactly as a live client would.
pub async fn issue_fixture_nonce(e: &Env) -> anyhow::Result<String> {
    e.owner
        .call(e.wallet.id(), "test_set_next_nonce")
        .args_json(json!({"nonce": e.fx.nonce}))
        .transact()
        .await?
        .into_result()?;
    let nonce: String = e
        .relayer
        .call(e.wallet.id(), "request_attestation_nonce")
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .json()?;
    Ok(nonce)
}

pub async fn register(
    e: &Env,
    profile: &str,
    address: &str,
    c: &Candidate,
    quote: Vec<u8>,
) -> anyhow::Result<(bool, Vec<String>, u64)> {
    let out = e
        .relayer
        .call(e.wallet.id(), "register_attested")
        .args_borsh((
            profile.to_string(),
            address.to_string(),
            QuoteBytes(quote),
            c.collateral.to_borsh(),
            c.app_compose.clone(),
        ))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?;
    let logs: Vec<String> = out.logs().iter().map(|s| s.to_string()).collect();
    let burnt = out.total_gas_burnt.as_gas();
    let ok: bool = out.into_result()?.json()?;
    Ok((ok, logs, burnt))
}

pub async fn is_valid(e: &Env, address: &str, profile: &str) -> anyhow::Result<bool> {
    Ok(e.wallet
        .view("is_key_valid")
        .args_json(json!({"address": address, "profile": profile}))
        .await?
        .json()?)
}

pub fn has_log(logs: &[String], needle: &str) -> bool {
    logs.iter().any(|l| l.contains(needle))
}

pub fn quote_of(c: &Candidate) -> Vec<u8> {
    hex::decode(&c.intel_quote).unwrap()
}

/// The transaction must fail, and its error must contain `msg`.
pub fn assert_fails_with(res: near_workspaces::result::ExecutionFinalResult, msg: &str) {
    let err = format!(
        "{:?}",
        res.into_result().expect_err("transaction should fail")
    );
    assert!(err.contains(msg), "expected {msg:?} in {err}");
}

pub async fn owner_call(e: &Env, method: &str, args: serde_json::Value) -> anyhow::Result<()> {
    e.owner
        .call(e.wallet.id(), method)
        .args_json(args)
        .transact()
        .await?
        .into_result()
        .map_err(|err| anyhow::anyhow!("owner call {method} failed: {err:?}"))?;
    Ok(())
}

pub async fn set_profile(e: &Env, name: &str, m: &Measurements) -> anyhow::Result<()> {
    owner_call(
        e,
        "set_profile",
        json!({"profile": name, "measurements": profile_json(m)}),
    )
    .await
}

/// Advance the sandbox until at least `ms` of block time has passed.
pub async fn advance_clock(e: &Env, ms: u64) -> anyhow::Result<()> {
    let start = e._worker.view_block().await?.timestamp();
    // The sandbox moves about 0.3 s per fast-forwarded block; overshoot, then check.
    e._worker.fast_forward(ms / 250 + 10).await?;
    let moved = (e._worker.view_block().await?.timestamp() - start) / 1_000_000;
    anyhow::ensure!(moved >= ms, "sandbox clock moved {moved} ms, needed {ms}");
    Ok(())
}

/// Raw registration call with chosen gas, returning the full outcome.
pub async fn register_raw(
    e: &Env,
    profile: &str,
    address: &str,
    c: &Candidate,
    gas_tgas: u64,
) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(e.relayer
        .call(e.wallet.id(), "register_attested")
        .args_borsh((
            profile.to_string(),
            address.to_string(),
            QuoteBytes(quote_of(c)),
            c.collateral.to_borsh(),
            c.app_compose.clone(),
        ))
        .gas(Gas::from_tgas(gas_tgas))
        .transact()
        .await?)
}
