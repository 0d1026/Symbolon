//! Payment path against the real verifier code, the real attested NEAR AI
//! key, real captured NEAR AI decisions and a mock USDC token.
//!
//! Build first: `./scripts/build.sh`.

mod common;
use common::pay::*;
use common::*;
use serde_json::json;

const PAID: &str = "paid";

#[tokio::test]
async fn pays_an_approved_invoice_end_to_end() -> anyhow::Result<()> {
    let p = pay_env().await?;
    let s = p.submission("market_data", "market_data");
    p.issue_pay_nonce("market_data", &s.invoice).await?;
    let wallet_before = p.wallet_balance().await?;

    let (result, logs) = p.pay(&s).await?;
    assert_eq!(result, PAID, "{logs:?}");
    assert!(has_log(&logs, "payment_sent"));
    assert!(has_log(&logs, "payment_completed"));
    assert_eq!(p.balance(&p.merchant).await?, 2_000_000);
    assert_eq!(p.wallet_balance().await?, wallet_before - 2_000_000);
    assert_eq!(p.window().await?, (2_000_000, 0));
    assert!(
        p.is_settled(p.merchant.id().as_str(), "00000000000000a1")
            .await?
    );
    Ok(())
}

#[tokio::test]
async fn refuses_when_the_model_refuses_and_burns_the_nonce() -> anyhow::Result<()> {
    let p = pay_env().await?;
    let s = p.submission("gift_cards", "gift_cards");
    p.issue_pay_nonce("gift_cards", &s.invoice).await?;

    let (result, logs) = p.pay(&s).await?;
    assert_eq!(
        result, "refused: model did not approve this invoice",
        "{logs:?}"
    );
    assert!(has_log(&logs, "payment_refused"));
    assert_eq!(p.balance(&p.merchant).await?, 0);

    let again = p.pay_as(&p.agent, &s, 100).await?;
    assert_fails_with(again, "no payment nonce for this invoice");
    Ok(())
}

#[tokio::test]
async fn refuses_a_genuinely_signed_decision_for_a_different_request() -> anyhow::Result<()> {
    let p = pay_env().await?;
    let forged = &p.d.cases["attacker_forged"];
    assert_eq!(forged.signature_kind, "provider_tee");
    assert_eq!(
        forged.signing_address.to_lowercase(),
        p.e.fx.candidates.model.signing_address.to_lowercase(),
        "the attacker's approval is signed by the same attested NEAR AI key"
    );

    let s = p.submission("gift_cards", "attacker_forged");
    p.issue_pay_nonce("gift_cards", &s.invoice).await?;
    let (result, logs) = p.pay(&s).await?;
    assert_eq!(
        result, "refused: decision not signed by an attested model key for this request",
        "{logs:?}"
    );
    assert_eq!(p.balance(&p.merchant).await?, 0);
    Ok(())
}

#[tokio::test]
async fn refuses_a_tampered_response() -> anyhow::Result<()> {
    let p = pay_env().await?;
    let mut s = p.submission("market_data", "market_data");
    let text = String::from_utf8(s.response.clone())?;
    let needle = r#"\"amount\": \"2000000\""#;
    assert!(text.contains(needle), "fixture shape changed");
    s.response = text
        .replacen(needle, r#"\"amount\": \"2000001\""#, 1)
        .into_bytes();
    p.issue_pay_nonce("market_data", &s.invoice).await?;

    let (result, _) = p.pay(&s).await?;
    assert_eq!(
        result,
        "refused: decision not signed by an attested model key for this request"
    );
    assert_eq!(p.balance(&p.merchant).await?, 0);
    Ok(())
}

#[tokio::test]
async fn refuses_a_decision_built_on_a_different_nonce() -> anyhow::Result<()> {
    let p = pay_env().await?;
    let s = p.submission("market_data", "market_data");
    p.issue_pay_nonce("gift_cards", &s.invoice).await?;
    let (result, _) = p.pay(&s).await?;
    assert_eq!(
        result,
        "refused: decision not signed by an attested model key for this request"
    );
    Ok(())
}

#[tokio::test]
async fn refuses_to_pay_the_same_invoice_twice() -> anyhow::Result<()> {
    let p = pay_env().await?;
    let s = p.submission("market_data", "market_data");
    p.issue_pay_nonce("market_data", &s.invoice).await?;
    assert_eq!(p.pay(&s).await?.0, PAID);

    let replay = p.pay_as(&p.agent, &s, 100).await?;
    assert_fails_with(replay, "no payment nonce for this invoice");

    p.issue_pay_nonce("market_data", &s.invoice).await?;
    let (result, _) = p.pay(&s).await?;
    assert_eq!(result, "refused: invoice already paid or pending");
    assert_eq!(p.balance(&p.merchant).await?, 2_000_000);
    Ok(())
}

#[tokio::test]
async fn refuses_signatures_from_keys_that_are_not_attested() -> anyhow::Result<()> {
    let p = pay_env().await?;
    owner_call(
        &p.e,
        "revoke_key",
        json!({ "address": p.e.fx.candidates.model.signing_address }),
    )
    .await?;
    let s = p.submission("market_data", "market_data");
    p.issue_pay_nonce("market_data", &s.invoice).await?;
    let (result, _) = p.pay(&s).await?;
    assert_eq!(
        result,
        "refused: decision not signed by an attested model key for this request"
    );
    Ok(())
}

#[tokio::test]
async fn refuses_malformed_signatures() -> anyhow::Result<()> {
    let p = pay_env().await?;
    let mut s = p.submission("market_data", "market_data");
    let mut sig = hex::decode(s.signature.trim_start_matches("0x"))?;
    sig[64] = 29;
    s.signature = format!("0x{}", hex::encode(&sig));
    p.issue_pay_nonce("market_data", &s.invoice).await?;
    let (result, _) = p.pay(&s).await?;
    assert_eq!(result, "refused: signature v must be 27 or 28");
    Ok(())
}

#[tokio::test]
async fn holds_a_large_payment_until_the_owner_approves() -> anyhow::Result<()> {
    let p = pay_env().await?;
    let s = p.submission("large_report", "large_report");
    p.issue_pay_nonce("large_report", &s.invoice).await?;
    let (result, logs) = p.pay(&s).await?;
    assert_eq!(result, "held:0", "{logs:?}");
    assert!(has_log(&logs, "payment_held"));
    assert_eq!(p.balance(&p.merchant).await?, 0);
    assert_eq!(p.window().await?, (0, 0));

    let res =
        p.e.relayer
            .call(p.e.wallet.id(), "approve_held")
            .args_json(json!({ "held_id": 0 }))
            .transact()
            .await?;
    assert_fails_with(res, "owner only");

    let out =
        p.e.owner
            .call(p.e.wallet.id(), "approve_held")
            .args_json(json!({ "held_id": 0 }))
            .gas(near_workspaces::types::Gas::from_tgas(100))
            .transact()
            .await?;
    let result: String = out.into_result()?.json()?;
    assert_eq!(result, PAID);
    assert_eq!(p.balance(&p.merchant).await?, 50_000_000);
    assert_eq!(p.window().await?, (50_000_000, 0));
    Ok(())
}

#[tokio::test]
async fn owner_can_reject_a_held_payment() -> anyhow::Result<()> {
    let p = pay_env().await?;
    let s = p.submission("large_report", "large_report");
    p.issue_pay_nonce("large_report", &s.invoice).await?;
    assert_eq!(p.pay(&s).await?.0, "held:0");
    assert!(
        p.is_settled(p.merchant.id().as_str(), "00000000000000c3")
            .await?
    );

    owner_call(&p.e, "reject_held", json!({ "held_id": 0 })).await?;
    assert!(
        !p.is_settled(p.merchant.id().as_str(), "00000000000000c3")
            .await?
    );
    assert_eq!(p.balance(&p.merchant).await?, 0);
    let held: Option<serde_json::Value> =
        p.e.wallet
            .view("get_held")
            .args_json(json!({ "held_id": 0 }))
            .await?
            .json()?;
    assert!(held.is_none());
    Ok(())
}

#[tokio::test]
async fn failed_transfer_rolls_back_the_reservation() -> anyhow::Result<()> {
    let p = pay_env_with_funds(1_000_000).await?;
    let s = p.submission("market_data", "market_data");
    p.issue_pay_nonce("market_data", &s.invoice).await?;
    let (result, logs) = p.pay(&s).await?;
    assert_eq!(result, "failed", "{logs:?}");
    assert!(has_log(&logs, "payment_failed"));
    assert_eq!(p.window().await?, (0, 0));
    assert!(
        !p.is_settled(p.merchant.id().as_str(), "00000000000000a1")
            .await?
    );
    assert_eq!(p.wallet_balance().await?, 1_000_000);
    Ok(())
}
