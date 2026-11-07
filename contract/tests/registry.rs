//! Sandbox tests for the attested key registry.
//!
//! They run NEAR One's real TDX verifier: `fixtures/tee_verifier_mainnet.wasm`
//! is the exact code deployed at `tee-verifier-2026-08-04.near` (code hash
//! 6RHv9Er2kDegVjCDcHaBvpbgjmgq5nAHodyBiHC4gZpa). The quotes are real NEAR AI
//! attestation reports fetched on 2026-11-07 with our own nonce. Their Intel
//! collateral is valid until 2026-12-06; after that the verifier rejects them
//! and these tests need a fresh capture (see scripts/capture_attestation.py).
//!
//! Build the test wasm first: `./scripts/build.sh` (enables `test-nonce`).

mod common;
use common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

// ---------------------------------------------------------------------------
// Happy paths against the real verifier code
// ---------------------------------------------------------------------------

#[tokio::test]
async fn registers_real_model_key_through_onchain_verifier() -> anyhow::Result<()> {
    let e = setup().await?;
    let nonce = issue_fixture_nonce(&e).await?;
    assert_eq!(nonce, e.fx.nonce);

    let c = e.fx.candidates.model.clone();
    let (ok, logs, burnt) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    println!(
        "gas burnt for registration: {:.1} Tgas",
        burnt as f64 / 1e12
    );
    assert!(ok, "logs: {logs:?}");
    assert!(has_log(&logs, "key_registered"));
    assert!(is_valid(&e, &c.signing_address, MODEL).await?);
    // A key is valid only under the profile it was attested for.
    assert!(!is_valid(&e, &c.signing_address, GATEWAY).await?);
    Ok(())
}

#[tokio::test]
async fn registers_gateway_key() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.gateway.clone();
    let (ok, logs, _) = register(&e, GATEWAY, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok, "logs: {logs:?}");
    assert!(is_valid(&e, &c.signing_address, GATEWAY).await?);
    Ok(())
}

// ---------------------------------------------------------------------------
// Proofs the registry must refuse
// ---------------------------------------------------------------------------

#[tokio::test]
async fn rejects_quote_claimed_for_a_different_signer_without_burning_the_nonce(
) -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.model.clone();
    let attacker = "0x1111111111111111111111111111111111111111";
    let (ok, logs, _) = register(&e, MODEL, attacker, &c, quote_of(&c)).await?;
    assert!(!ok);
    assert!(
        has_log(&logs, "report_data does not bind this signing address"),
        "{logs:?}"
    );
    assert!(!is_valid(&e, attacker, MODEL).await?);
    // The failed attempt did not consume the nonce: the honest submission still works.
    let (ok, logs, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok, "{logs:?}");
    Ok(())
}

#[tokio::test]
async fn rejects_nonce_not_issued_by_contract() -> anyhow::Result<()> {
    let e = setup().await?;
    let c = e.fx.candidates.model.clone();
    let (ok, logs, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(!ok);
    assert!(has_log(&logs, "nonce was not issued"), "{logs:?}");
    Ok(())
}

#[tokio::test]
async fn rejects_replayed_nonce() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.model.clone();
    let (ok, _, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok);
    let (ok2, logs, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(!ok2);
    assert!(has_log(&logs, "nonce was not issued"), "{logs:?}");
    Ok(())
}

#[tokio::test]
async fn rejects_expired_nonce() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    advance_clock(&e, 15 * 60 * 1000 + 1).await?;
    let c = e.fx.candidates.model.clone();
    let (ok, logs, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(!ok);
    assert!(has_log(&logs, "nonce expired"), "{logs:?}");
    Ok(())
}

#[tokio::test]
async fn rejects_tampered_quote_with_a_valid_json_event() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.model.clone();
    let mut q = quote_of(&c);
    // Byte 600 lies in report_data (bytes 568..632 of a TDX v4 quote).
    q[600] ^= 0x01;
    let (ok, logs, _) = register(&e, MODEL, &c.signing_address, &c, q).await?;
    assert!(!ok);
    let ev = logs
        .iter()
        .find(|l| l.contains("key_rejected"))
        .expect("rejection event");
    let v: serde_json::Value = serde_json::from_str(ev.trim_start_matches("EVENT_JSON:"))?;
    assert_eq!(v["standard"], "symbolon");
    assert!(v["data"][0]["reason"]
        .as_str()
        .unwrap()
        .contains("verifier rejected"));
    Ok(())
}

#[tokio::test]
async fn rejects_app_compose_that_is_not_the_one_in_the_quote() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    // Owner allowlists both compose files for the model, so the pre-check passes,
    // but the quote's MRCONFIGID binds the model's own compose file.
    let mut m = e.fx.candidates.model.measurements.clone();
    m.compose_hash = e.fx.candidates.gateway.measurements.compose_hash.clone();
    let both = json!({
        "mr_td": [m.mr_td], "rt_mr0": [m.rt_mr0], "rt_mr1": [m.rt_mr1], "rt_mr2": [m.rt_mr2],
        "compose_hashes": [e.fx.candidates.model.measurements.compose_hash, m.compose_hash]
    });
    owner_call(
        &e,
        "set_profile",
        json!({"profile": MODEL, "measurements": both}),
    )
    .await?;
    let model = e.fx.candidates.model.clone();
    let mut c = model.clone();
    c.app_compose = e.fx.candidates.gateway.app_compose.clone();
    let (ok, logs, _) = register(&e, MODEL, &model.signing_address, &c, quote_of(&model)).await?;
    assert!(!ok);
    assert!(
        has_log(&logs, "MRCONFIGID does not match app_compose"),
        "{logs:?}"
    );
    Ok(())
}

#[tokio::test]
async fn rejects_measurements_not_allowlisted() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.model.clone();
    // Owner allowlists the gateway's OS image instead of the model's.
    let mut m = c.measurements.clone();
    m.mr_td = e.fx.candidates.gateway.measurements.mr_td.clone();
    set_profile(&e, MODEL, &m).await?;
    let (ok, logs, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(!ok);
    assert!(has_log(&logs, "mr_td not allowlisted"), "{logs:?}");
    Ok(())
}

#[tokio::test]
async fn rejects_tcb_status_outside_owner_policy() -> anyhow::Result<()> {
    let e = setup().await?;
    owner_call(
        &e,
        "set_accepted_tcb_statuses",
        json!({"statuses": ["SWHardeningNeeded"]}),
    )
    .await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.model.clone();
    let (ok, logs, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(!ok);
    assert!(
        has_log(&logs, "tcb status UpToDate not accepted"),
        "{logs:?}"
    );
    Ok(())
}

#[tokio::test]
async fn rejects_key_already_registered_under_another_profile() -> anyhow::Result<()> {
    let e = setup().await?;
    let c = e.fx.candidates.model.clone();
    set_profile(&e, "copy-of-model", &c.measurements).await?;
    issue_fixture_nonce(&e).await?;
    let (ok, _, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok);
    issue_fixture_nonce(&e).await?;
    let (ok, logs, _) = register(&e, "copy-of-model", &c.signing_address, &c, quote_of(&c)).await?;
    assert!(!ok);
    assert!(
        has_log(&logs, "already registered under another profile"),
        "{logs:?}"
    );
    assert!(is_valid(&e, &c.signing_address, MODEL).await?);
    Ok(())
}

#[tokio::test]
async fn reports_verifier_failure_as_a_rejection() -> anyhow::Result<()> {
    let e = setup().await?;
    // Point at an account with no contract: the cross-contract call fails.
    owner_call(&e, "set_verifier", json!({"verifier": e.relayer.id()})).await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.model.clone();
    let (ok, logs, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(!ok);
    assert!(has_log(&logs, "verifier call failed"), "{logs:?}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Input checks before any verifier gas is spent
// ---------------------------------------------------------------------------

#[tokio::test]
async fn refuses_bad_submissions_before_calling_the_verifier() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    let model = e.fx.candidates.model.clone();

    // Compose file not on the allowlist: refused cheaply, no verifier call.
    let mut c = model.clone();
    c.app_compose = e.fx.candidates.gateway.app_compose.clone();
    let res = register_raw(&e, MODEL, &model.signing_address, &c, 300).await?;
    let burnt = res.total_gas_burnt.as_gas();
    assert!(
        burnt < 20_000_000_000_000,
        "burnt {burnt} gas; verifier must not run"
    );
    assert_fails_with(res, "compose hash not allowlisted for this profile");

    let mut big = model.clone();
    big.app_compose = "x".repeat(128 * 1024 + 1);
    assert_fails_with(
        register_raw(&e, MODEL, &model.signing_address, &big, 300).await?,
        "app_compose too large",
    );
    assert_fails_with(
        register_raw(&e, "no-such-profile", &model.signing_address, &model, 300).await?,
        "unknown profile",
    );
    assert_fails_with(
        register_raw(&e, MODEL, "0x1234", &model, 300).await?,
        "signing address must be 20 bytes of hex",
    );
    assert_fails_with(
        register_raw(&e, MODEL, &model.signing_address, &model, 200).await?,
        "attach at least 240 Tgas",
    );

    // None of these touched the nonce: the real submission still registers.
    let (ok, logs, _) =
        register(&e, MODEL, &model.signing_address, &model, quote_of(&model)).await?;
    assert!(ok, "{logs:?}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Keys over time and policy changes
// ---------------------------------------------------------------------------

#[tokio::test]
async fn key_expires_after_its_lifetime() -> anyhow::Result<()> {
    let e = setup().await?;
    owner_call(&e, "set_key_ttl_ms", json!({"key_ttl_ms": 60_000u64})).await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.model.clone();
    let (ok, _, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok);
    assert!(is_valid(&e, &c.signing_address, MODEL).await?);
    advance_clock(&e, 60_001).await?;
    assert!(!is_valid(&e, &c.signing_address, MODEL).await?);
    Ok(())
}

#[tokio::test]
async fn policy_change_invalidates_existing_keys() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.model.clone();
    let (ok, _, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok);

    // Owner drops the compose hash this key was attested with.
    let mut m = c.measurements.clone();
    m.compose_hash = e.fx.candidates.gateway.measurements.compose_hash.clone();
    set_profile(&e, MODEL, &m).await?;
    assert!(!is_valid(&e, &c.signing_address, MODEL).await?);

    // Restoring it restores the key; removing the profile kills it.
    set_profile(&e, MODEL, &c.measurements).await?;
    assert!(is_valid(&e, &c.signing_address, MODEL).await?);
    owner_call(&e, "remove_profile", json!({"profile": MODEL})).await?;
    assert!(!is_valid(&e, &c.signing_address, MODEL).await?);
    Ok(())
}

#[tokio::test]
async fn owner_can_revoke_a_key() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    let c = e.fx.candidates.model.clone();
    let (ok, _, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok);
    owner_call(&e, "revoke_key", json!({"address": c.signing_address})).await?;
    assert!(!is_valid(&e, &c.signing_address, MODEL).await?);
    Ok(())
}

#[tokio::test]
async fn expired_nonces_are_pruned_by_anyone() -> anyhow::Result<()> {
    let e = setup().await?;
    issue_fixture_nonce(&e).await?;
    advance_clock(&e, 15 * 60 * 1000 + 1).await?;
    let removed: u32 = e
        .relayer
        .call(e.wallet.id(), "prune_expired_nonces")
        .args_json(json!({"limit": 10}))
        .transact()
        .await?
        .json()?;
    assert_eq!(removed, 1);
    Ok(())
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

#[tokio::test]
async fn only_owner_can_change_policy() -> anyhow::Result<()> {
    let e = setup().await?;
    let m = e.fx.candidates.model.measurements.clone();
    let calls = [
        (
            "set_profile",
            json!({"profile": MODEL, "measurements": profile_json(&m)}),
        ),
        ("remove_profile", json!({"profile": MODEL})),
        (
            "set_accepted_tcb_statuses",
            json!({"statuses": ["OutOfDate"]}),
        ),
        ("set_key_ttl_ms", json!({"key_ttl_ms": 1u64})),
        (
            "revoke_key",
            json!({"address": e.fx.candidates.model.signing_address}),
        ),
        ("set_verifier", json!({"verifier": e.relayer.id()})),
        ("propose_owner", json!({"new_owner": e.relayer.id()})),
        ("test_set_next_nonce", json!({"nonce": e.fx.nonce})),
    ];
    for (method, args) in calls {
        let res = e
            .relayer
            .call(e.wallet.id(), method)
            .args_json(args)
            .transact()
            .await?;
        assert_fails_with(res, "owner only");
    }
    Ok(())
}

#[tokio::test]
async fn ownership_moves_only_when_the_new_owner_accepts() -> anyhow::Result<()> {
    let e = setup().await?;
    // Nobody can accept before a proposal.
    let res = e
        .relayer
        .call(e.wallet.id(), "accept_owner")
        .transact()
        .await?;
    assert_fails_with(res, "only the proposed owner can accept");

    owner_call(&e, "propose_owner", json!({"new_owner": e.relayer.id()})).await?;
    // Proposing alone changes nothing.
    owner_call(&e, "set_key_ttl_ms", json!({"key_ttl_ms": 5u64})).await?;
    e.relayer
        .call(e.wallet.id(), "accept_owner")
        .transact()
        .await?
        .into_result()?;

    let res = e
        .owner
        .call(e.wallet.id(), "set_key_ttl_ms")
        .args_json(json!({"key_ttl_ms": 6u64}))
        .transact()
        .await?;
    assert_fails_with(res, "owner only");
    e.relayer
        .call(e.wallet.id(), "set_key_ttl_ms")
        .args_json(json!({"key_ttl_ms": 7u64}))
        .transact()
        .await?
        .into_result()?;
    let pending: Option<String> = e.wallet.view("get_pending_owner").await?.json()?;
    assert!(pending.is_none());
    Ok(())
}

#[tokio::test]
async fn nonce_requires_fee() -> anyhow::Result<()> {
    let e = setup().await?;
    let res = e
        .relayer
        .call(e.wallet.id(), "request_attestation_nonce")
        .deposit(NearToken::from_millinear(9))
        .transact()
        .await?;
    assert_fails_with(res, "attach at least 0.01 NEAR");
    Ok(())
}

#[tokio::test]
async fn set_profile_rejects_malformed_measurements() -> anyhow::Result<()> {
    let e = setup().await?;
    let m = e.fx.candidates.model.measurements.clone();
    let mut short = profile_json(&m);
    short["mr_td"] = json!(["abcd"]);
    let res = e
        .owner
        .call(e.wallet.id(), "set_profile")
        .args_json(json!({"profile": MODEL, "measurements": short}))
        .transact()
        .await?;
    assert_fails_with(res, "bad measurement hex length");
    let mut empty = profile_json(&m);
    empty["rt_mr1"] = json!([]);
    let res = e
        .owner
        .call(e.wallet.id(), "set_profile")
        .args_json(json!({"profile": MODEL, "measurements": empty}))
        .transact()
        .await?;
    assert_fails_with(res, "every measurement list must be non-empty");
    Ok(())
}

// ---------------------------------------------------------------------------
// Production build and stored records
// ---------------------------------------------------------------------------

#[tokio::test]
async fn production_build_issues_fresh_random_nonces_and_has_no_test_hook() -> anyhow::Result<()> {
    let e = setup_with(&std::fs::read(VERIFIER_WASM)?, PROD_WASM).await?;
    let mut seen = std::collections::HashSet::new();
    for _ in 0..3 {
        let out = e
            .relayer
            .call(e.wallet.id(), "request_attestation_nonce")
            .deposit(NearToken::from_millinear(10))
            .transact()
            .await?;
        let logs: Vec<String> = out.logs().iter().map(|s| s.to_string()).collect();
        let nonce: String = out.into_result()?.json()?;
        assert_eq!(nonce.len(), 64, "{nonce}");
        assert!(nonce.bytes().all(|b| b.is_ascii_hexdigit()));
        // The event carries the same nonce the call returned.
        assert!(
            has_log(&logs, &format!("\"nonce\":\"{nonce}\"")),
            "{logs:?}"
        );
        assert!(seen.insert(nonce), "nonce repeated");
    }
    // The test-only override does not exist in the production build.
    let res = e
        .owner
        .call(e.wallet.id(), "test_set_next_nonce")
        .args_json(json!({"nonce": e.fx.nonce}))
        .transact()
        .await?;
    assert_fails_with(res, "MethodNotFound");
    // A real quote carries the fixture's nonce, which this contract never issued.
    let c = e.fx.candidates.model.clone();
    let (ok, logs, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(!ok);
    assert!(has_log(&logs, "nonce was not issued"), "{logs:?}");
    Ok(())
}

#[derive(serde::Deserialize, Debug)]
struct KeyRecord {
    profile: String,
    compose_hash: String,
    mr_td: String,
    rt_mr0: String,
    rt_mr1: String,
    rt_mr2: String,
    tcb_status: String,
    registered_at_ms: u64,
    expires_at_ms: u64,
    submitter: String,
}

async fn get_key(e: &Env, address: &str) -> anyhow::Result<Option<KeyRecord>> {
    Ok(e.wallet
        .view("get_key")
        .args_json(json!({"address": address}))
        .await?
        .json()?)
}

#[tokio::test]
async fn stored_record_matches_the_attested_quote() -> anyhow::Result<()> {
    let e = setup().await?;
    let c = e.fx.candidates.model.clone();
    assert!(get_key(&e, &c.signing_address).await?.is_none());
    issue_fixture_nonce(&e).await?;
    let (ok, _, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok);
    // Upper-case and 0x-less lookups resolve to the same record.
    let upper = c.signing_address.trim_start_matches("0x").to_uppercase();
    let r = get_key(&e, &upper).await?.expect("record");
    let m = &c.measurements;
    assert_eq!(r.profile, MODEL);
    assert_eq!(r.compose_hash, m.compose_hash);
    assert_eq!(r.mr_td, m.mr_td);
    assert_eq!(r.rt_mr0, m.rt_mr0);
    assert_eq!(r.rt_mr1, m.rt_mr1);
    assert_eq!(r.rt_mr2, m.rt_mr2);
    assert_eq!(r.tcb_status, "UpToDate");
    assert_eq!(r.submitter, e.relayer.id().as_str());
    assert_eq!(r.expires_at_ms - r.registered_at_ms, 7 * 24 * 3600 * 1000);
    Ok(())
}

#[tokio::test]
async fn reregistering_refreshes_the_key_lifetime() -> anyhow::Result<()> {
    let e = setup().await?;
    let c = e.fx.candidates.model.clone();
    issue_fixture_nonce(&e).await?;
    let (ok, _, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok);
    let first = get_key(&e, &c.signing_address).await?.expect("record");

    advance_clock(&e, 5_000).await?;
    issue_fixture_nonce(&e).await?;
    let (ok, logs, _) = register(&e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    assert!(ok, "{logs:?}");
    let second = get_key(&e, &c.signing_address).await?.expect("record");
    assert!(second.registered_at_ms >= first.registered_at_ms + 5_000);
    assert!(second.expires_at_ms >= first.expires_at_ms + 5_000);
    Ok(())
}
