//! Sandbox tests with a fake verifier (`mock-verifier/`), for verifier answers
//! no genuine NEAR AI quote can produce. Everything else runs against the real
//! verifier code in tests/registry.rs.
//!
//! Build first: `./scripts/build.sh` (also builds the mock).

mod common;
use common::*;
use near_sdk::json_types::Base64VecU8;
use serde_json::json;
use symbolon::verifier::*;

const MOCK_WASM: &str = "../target/near/mock/mock_verifier.wasm";

/// A verifier answer that passes every Symbolon check for the fixture's model
/// key and nonce. Each test changes one thing.
fn good_report(e: &Env) -> TDReport10 {
    let c = &e.fx.candidates.model;
    let m = &c.measurements;
    let h48 = |s: &str| -> [u8; 48] { hex::decode(s).unwrap().try_into().unwrap() };
    let mut report_data = [0u8; 64];
    report_data[..20]
        .copy_from_slice(&hex::decode(c.signing_address.trim_start_matches("0x")).unwrap());
    report_data[32..].copy_from_slice(&hex::decode(&e.fx.nonce).unwrap());
    let mut mr_config_id = [0u8; 48];
    mr_config_id[0] = 1;
    mr_config_id[1..33].copy_from_slice(&hex::decode(&m.compose_hash).unwrap());
    TDReport10 {
        tee_tcb_svn: [0; 16],
        mr_seam: [0; 48],
        mr_signer_seam: [0; 48],
        seam_attributes: [0; 8],
        td_attributes: [0; 8],
        xfam: [0; 8],
        mr_td: h48(&m.mr_td),
        mr_config_id,
        mr_owner: [0; 48],
        mr_owner_config: [0; 48],
        rt_mr0: h48(&m.rt_mr0),
        rt_mr1: h48(&m.rt_mr1),
        rt_mr2: h48(&m.rt_mr2),
        rt_mr3: [0; 48],
        report_data,
    }
}

fn verified(td: TDReport10) -> VerificationResult {
    let ok = TcbStatusWithAdvisory {
        status: TcbStatus::UpToDate,
        advisory_ids: vec![],
    };
    VerificationResult::Verified(VerifiedReport {
        status: "UpToDate".into(),
        advisory_ids: vec![],
        report: Report::TD10(td),
        ppid: vec![],
        qe_status: ok.clone(),
        platform_status: ok,
    })
}

async fn mock_env() -> anyhow::Result<Env> {
    let wasm = std::fs::read(MOCK_WASM)
        .map_err(|e| anyhow::anyhow!("{MOCK_WASM}: {e}. Run ./scripts/build.sh first"))?;
    setup_with_verifier(&wasm).await
}

async fn set_answer(e: &Env, answer: &VerificationResult) -> anyhow::Result<()> {
    let bytes = borsh::to_vec(answer)?;
    e.relayer
        .call(e.verifier.id(), "set_answer")
        .args_json(json!({ "answer_base64": Base64VecU8::from(bytes) }))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn submit(e: &Env) -> anyhow::Result<(bool, Vec<String>)> {
    let c = e.fx.candidates.model.clone();
    let (ok, logs, _) = register(e, MODEL, &c.signing_address, &c, quote_of(&c)).await?;
    Ok((ok, logs))
}

#[tokio::test]
async fn mock_harness_accepts_a_well_formed_answer() -> anyhow::Result<()> {
    // Control: proves the refusals below come from the one field each test changes.
    let e = mock_env().await?;
    issue_fixture_nonce(&e).await?;
    set_answer(&e, &verified(good_report(&e))).await?;
    let (ok, logs) = submit(&e).await?;
    assert!(ok, "{logs:?}");
    assert!(is_valid(&e, &e.fx.candidates.model.signing_address, MODEL).await?);
    Ok(())
}

#[tokio::test]
async fn refuses_report_with_tdx_debug_mode_on() -> anyhow::Result<()> {
    let e = mock_env().await?;
    issue_fixture_nonce(&e).await?;
    let mut td = good_report(&e);
    td.td_attributes[0] |= 1;
    set_answer(&e, &verified(td)).await?;
    let (ok, logs) = submit(&e).await?;
    assert!(!ok);
    assert!(has_log(&logs, "TDX debug mode enabled"), "{logs:?}");
    assert!(!is_valid(&e, &e.fx.candidates.model.signing_address, MODEL).await?);
    Ok(())
}

#[tokio::test]
async fn rejection_reason_with_quotes_and_backslashes_stays_valid_json() -> anyhow::Result<()> {
    let e = mock_env().await?;
    issue_fixture_nonce(&e).await?;
    let err = VerifierError::DcapVerification("bad \"cert\" at C:\\pki\nline 2".into());
    set_answer(&e, &VerificationResult::Rejected(err.clone())).await?;
    let (ok, logs) = submit(&e).await?;
    assert!(!ok);
    let ev = logs
        .iter()
        .find(|l| l.contains("key_rejected"))
        .expect("rejection event");
    let v: serde_json::Value = serde_json::from_str(ev.trim_start_matches("EVENT_JSON:"))?;
    assert_eq!(
        v["data"][0]["reason"],
        format!("verifier rejected: {err:?}")
    );
    Ok(())
}

#[tokio::test]
async fn refuses_verifier_answer_longer_than_the_read_limit() -> anyhow::Result<()> {
    let e = mock_env().await?;
    issue_fixture_nonce(&e).await?;
    // Symbolon reads at most 4096 bytes back; a real answer is 632.
    e.relayer
        .call(e.verifier.id(), "set_answer")
        .args_json(json!({ "answer_base64": Base64VecU8::from(vec![0u8; 4097]) }))
        .transact()
        .await?
        .into_result()?;
    let (ok, logs) = submit(&e).await?;
    assert!(!ok);
    assert!(
        has_log(&logs, "verifier call failed or result too long"),
        "{logs:?}"
    );
    Ok(())
}
