//! Payment test setup: real attested model key, real captured NEAR AI
//! decisions (fixtures/decisions_2026-11-07.json), mock USDC, and an agent
//! function-call key on the wallet.

use super::*;
use near_sdk::json_types::Base64VecU8;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{KeyType, SecretKey};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const DECISIONS: &str = "tests/fixtures/decisions_2026-11-07.json";
pub const MERCHANT_CAP: u128 = 60_000_000;
pub const WALLET_FUNDS: u128 = 1_000_000_000;

#[derive(Deserialize, Clone)]
pub struct Decisions {
    pub policy: serde_json::Value,
    pub merchant: Party,
    pub outsider: Party,
    pub nonces: HashMap<String, String>,
    pub invoices: HashMap<String, SignedInvoice>,
    pub cases: HashMap<String, Case>,
}

#[derive(Deserialize, Clone)]
pub struct Party {
    pub account: String,
    pub invoice_key: String,
}

#[derive(Deserialize, Clone)]
pub struct SignedInvoice {
    pub invoice: String,
    pub invoice_sig: String,
}

#[derive(Deserialize, Clone)]
pub struct Case {
    pub invoice: String,
    pub response: Base64VecU8,
    pub signature: String,
    pub signing_address: String,
    pub signature_kind: String,
}

pub struct PayEnv {
    pub e: Env,
    pub d: Decisions,
    pub agent: Account,
    pub merchant: Account,
    pub outsider: Account,
}

pub struct Submission {
    pub invoice: String,
    pub invoice_sig: Vec<u8>,
    pub response: Vec<u8>,
    pub signature: String,
}

pub fn sha256_hex(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

pub async fn pay_env() -> anyhow::Result<PayEnv> {
    pay_env_with_funds(WALLET_FUNDS).await
}

pub async fn pay_env_with_funds(wallet_funds: u128) -> anyhow::Result<PayEnv> {
    let e = setup().await?;
    let d: Decisions = serde_json::from_str(&std::fs::read_to_string(DECISIONS)?)?;

    issue_fixture_nonce(&e).await?;
    let model = e.fx.candidates.model.clone();
    let (ok, logs, _) =
        register(&e, MODEL, &model.signing_address, &model, quote_of(&model)).await?;
    anyhow::ensure!(ok, "model key registration failed: {logs:?}");

    let root = e._worker.root_account()?;
    let merchant = root
        .create_subaccount("merchant")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()
        .map_err(|err| anyhow::anyhow!("create merchant failed: {err:?}"))?;
    let outsider = root
        .create_subaccount("outsider")
        .initial_balance(NearToken::from_near(5))
        .transact()
        .await?
        .into_result()
        .map_err(|err| anyhow::anyhow!("create outsider failed: {err:?}"))?;
    anyhow::ensure!(
        merchant.id().as_str() == d.merchant.account,
        "sandbox merchant id differs from fixture"
    );
    anyhow::ensure!(
        outsider.id().as_str() == d.outsider.account,
        "sandbox outsider id differs from fixture"
    );

    owner_call(&e, "set_policy_template", json!({ "template": d.policy })).await?;
    e.owner
        .call(e.wallet.id(), "add_merchant")
        .args_json(json!({
            "account_id": merchant.id(),
            "invoice_key": d.merchant.invoice_key,
            "cap": MERCHANT_CAP.to_string(),
        }))
        .deposit(NearToken::from_millinear(10))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?
        .into_result()
        .map_err(|err| anyhow::anyhow!("add_merchant failed: {err:?}"))?;
    owner_call(
        &e,
        "set_caps",
        json!({ "caps": { "approval_threshold": "10000000", "per_payment": "60000000", "per_day": "100000000" } }),
    )
    .await?;

    e.owner
        .call(e.usdc.id(), "storage_deposit")
        .args_json(json!({ "account_id": e.wallet.id(), "registration_only": true }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()
        .map_err(|err| anyhow::anyhow!("wallet storage_deposit failed: {err:?}"))?;
    e.owner
        .call(e.usdc.id(), "ft_transfer")
        .args_json(json!({ "receiver_id": e.wallet.id(), "amount": wallet_funds.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()
        .map_err(|err| anyhow::anyhow!("fund wallet failed: {err:?}"))?;

    let sk = SecretKey::from_random(KeyType::ED25519);
    owner_call(
        &e,
        "set_agent_key",
        json!({ "public_key": sk.public_key().to_string(), "allowance": NearToken::from_near(1) }),
    )
    .await?;
    let agent = Account::from_secret_key(e.wallet.id().clone(), sk, &e._worker);

    Ok(PayEnv {
        e,
        d,
        agent,
        merchant,
        outsider,
    })
}

impl PayEnv {
    pub fn submission(&self, invoice_name: &str, case_name: &str) -> Submission {
        let inv = &self.d.invoices[invoice_name];
        let c = &self.d.cases[case_name];
        Submission {
            invoice: inv.invoice.clone(),
            invoice_sig: hex::decode(&inv.invoice_sig).unwrap(),
            response: c.response.0.clone(),
            signature: c.signature.clone(),
        }
    }

    /// Pins the next nonce to the one the captured request used, then the
    /// agent key requests it for this invoice, as the live client does.
    pub async fn issue_pay_nonce(&self, nonce_name: &str, invoice: &str) -> anyhow::Result<String> {
        owner_call(
            &self.e,
            "test_set_next_nonce",
            json!({ "nonce": self.d.nonces[nonce_name] }),
        )
        .await?;
        let nonce: String = self
            .agent
            .call(self.e.wallet.id(), "request_nonce")
            .args_json(json!({ "invoice_hash": sha256_hex(invoice.as_bytes()) }))
            .transact()
            .await?
            .into_result()
            .map_err(|err| anyhow::anyhow!("request_nonce failed: {err:?}"))?
            .json()?;
        Ok(nonce)
    }

    pub async fn pay_as(
        &self,
        who: &Account,
        s: &Submission,
        gas_tgas: u64,
    ) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who
            .call(self.e.wallet.id(), "pay")
            .args_borsh((
                s.invoice.clone(),
                s.invoice_sig.clone(),
                s.response.clone(),
                s.signature.clone(),
            ))
            .gas(Gas::from_tgas(gas_tgas))
            .transact()
            .await?)
    }

    /// Agent pays; returns the contract's result string and the logs.
    pub async fn pay(&self, s: &Submission) -> anyhow::Result<(String, Vec<String>)> {
        let out = self.pay_as(&self.agent, s, 100).await?;
        let logs: Vec<String> = out.logs().iter().map(|l| l.to_string()).collect();
        let result: String = out.into_result()?.json()?;
        Ok((result, logs))
    }

    pub async fn balance(&self, account: &Account) -> anyhow::Result<u128> {
        self.balance_of(account.id().as_str()).await
    }

    pub async fn balance_of(&self, account: &str) -> anyhow::Result<u128> {
        let b: String = self
            .e
            .usdc
            .view("ft_balance_of")
            .args_json(json!({ "account_id": account }))
            .await?
            .json()?;
        Ok(b.parse()?)
    }

    pub async fn wallet_balance(&self) -> anyhow::Result<u128> {
        self.balance_of(self.e.wallet.id().as_str()).await
    }

    pub async fn window(&self) -> anyhow::Result<(u128, u128)> {
        let w: serde_json::Value = self.e.wallet.view("get_spend_window").await?.json()?;
        Ok((
            w["spent"].as_str().unwrap().parse()?,
            w["pending"].as_str().unwrap().parse()?,
        ))
    }

    pub async fn is_settled(&self, payee: &str, invoice_id: &str) -> anyhow::Result<bool> {
        Ok(self
            .e
            .wallet
            .view("is_settled")
            .args_json(json!({ "payee": payee, "invoice_id": invoice_id }))
            .await?
            .json()?)
    }
}
