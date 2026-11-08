//! Upgrading the build deployed at `v2.symbolon.testnet` (fixture
//! `symbolon_v2_testnet.wasm`, fetched with `view_code`, code hash
//! `2HdCEMJF33FRmEdCbddtuB21g7pQH9MdH8wfF7hDupYa`) to the current production
//! build, through `migrate`.
//!
//! Build first: `./scripts/build.sh`.

mod common;
use common::*;
use near_workspaces::operations::Function;
use near_workspaces::types::{Gas, NearToken};
use serde_json::json;

const V2_WASM: &str = "tests/fixtures/symbolon_v2_testnet.wasm";

#[tokio::test]
async fn deployed_v2_state_migrates_to_the_current_build() -> anyhow::Result<()> {
    let e = setup_with(&std::fs::read(VERIFIER_WASM)?, V2_WASM).await?;
    let merchant = e.relayer.id().clone();
    owner_call(
        &e,
        "set_caps",
        json!({ "caps": { "approval_threshold": "10000000", "per_payment": "60000000", "per_day": "100000000" } }),
    )
    .await?;
    e.owner
        .call(e.wallet.id(), "add_merchant")
        .args_json(
            json!({ "account_id": merchant, "invoice_key": "11".repeat(32), "cap": "60000000" }),
        )
        .transact()
        .await?
        .into_result()?;
    let caps_before: serde_json::Value = e.wallet.view("get_caps").await?.json()?;
    let profile_before: serde_json::Value = e
        .wallet
        .view("get_profile")
        .args_json(json!({"profile": MODEL}))
        .await?
        .json()?;
    let config_before: serde_json::Value = e.wallet.view("get_config").await?.json()?;

    let current = std::fs::read(PROD_WASM)?;
    e.wallet
        .as_account()
        .batch(e.wallet.id())
        .deploy(&current)
        .call(Function::new("migrate").gas(Gas::from_tgas(50)))
        .transact()
        .await?
        .into_result()?;

    let caps_after: serde_json::Value = e.wallet.view("get_caps").await?.json()?;
    let profile_after: serde_json::Value = e
        .wallet
        .view("get_profile")
        .args_json(json!({"profile": MODEL}))
        .await?
        .json()?;
    let config_after: serde_json::Value = e.wallet.view("get_config").await?.json()?;
    assert_eq!(caps_before, caps_after);
    assert_eq!(profile_before, profile_after);
    assert_eq!(config_before, config_after);
    let m: serde_json::Value = e
        .wallet
        .view("get_merchant")
        .args_json(json!({"account_id": merchant}))
        .await?
        .json()?;
    assert_eq!(m["cap"], "60000000");

    owner_call(
        &e,
        "revoke_key",
        json!({"address": e.fx.candidates.model.signing_address}),
    )
    .await?;
    owner_call(
        &e,
        "unrevoke_key",
        json!({"address": e.fx.candidates.model.signing_address}),
    )
    .await?;

    e.owner
        .call(e.wallet.id(), "update_contract")
        .args(current)
        .gas(Gas::from_tgas(300))
        .deposit(NearToken::from_yoctonear(0))
        .transact()
        .await?
        .into_result()?;
    let caps_again: serde_json::Value = e.wallet.view("get_caps").await?.json()?;
    assert_eq!(caps_before, caps_again);
    Ok(())
}
