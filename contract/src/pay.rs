//! Payment path. The wallet pays a merchant-signed invoice in USDC only after a
//! NEAR AI policy decision, signed by a key attested in the registry, approves
//! exactly that invoice over a request the contract rebuilds itself.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseOrValue, PublicKey};

use crate::{emit, Symbolon, SymbolonExt};

const PAY_NONCE_TTL_MS: u64 = 10 * 60 * 1000;
const MAX_LIVE_PAY_NONCES: u32 = 32;
const PAY_MIN_GAS: Gas = Gas::from_tgas(40);
const FT_TRANSFER_GAS: Gas = Gas::from_tgas(15);
const ON_PAID_GAS: Gas = Gas::from_tgas(10);
const STORAGE_DEPOSIT_GAS: Gas = Gas::from_tgas(10);
const ADD_MERCHANT_WITH_DEPOSIT_GAS: Gas = Gas::from_tgas(25);
const MAX_INVOICE_LEN: usize = 300;
const MAX_MEMO_LEN: usize = 64;
const MAX_RESPONSE_LEN: usize = 16 * 1024;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const AGENT_METHODS: &str = "request_nonce,pay";

/// Exact request bytes the owner approves:
/// `prefix + nonce + middle + invoice + suffix`. `model_id` is the model name
/// inside NEAR AI's signed text; `profile` is the registry profile its key
/// must be attested under.
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [json, borsh])]
pub struct PolicyTemplate {
    pub model_id: String,
    pub profile: String,
    pub prefix: String,
    pub middle: String,
    pub suffix: String,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [json, borsh])]
pub struct Merchant {
    /// Hex ed25519 public key that signs this merchant's invoices.
    pub invoice_key: String,
    pub cap: U128,
}

/// USDC base units. A payment above `approval_threshold` waits for the owner.
#[derive(Clone, Debug, PartialEq, Default)]
#[near(serializers = [json, borsh])]
pub struct Caps {
    pub per_payment: U128,
    pub per_day: U128,
    pub approval_threshold: U128,
}

#[derive(Clone, Debug, PartialEq, Default)]
#[near(serializers = [json, borsh])]
pub struct SpendWindow {
    pub day: u64,
    pub spent: U128,
    pub pending: U128,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [json, borsh])]
pub struct PayNonce {
    pub nonce: String,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [json, borsh])]
pub struct HeldPayment {
    pub invoice_id: String,
    pub payee: AccountId,
    pub amount: U128,
    pub request_hash: String,
    pub response_hash: String,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Invoice {
    pub id: String,
    pub payee: AccountId,
    pub amount: u128,
    pub exp: u64,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Completion {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Choice {
    message: Message,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Message {
    content: Option<String>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Decision {
    approve: bool,
    payee: String,
    amount: String,
    invoice_id: String,
}

#[near]
impl Symbolon {
    /// Agent key only. Issues the single-use nonce that the policy request
    /// for this invoice must contain. `invoice_hash` is sha256 of the invoice, hex.
    pub fn request_nonce(&mut self, invoice_hash: String) -> String {
        self.assert_agent();
        let invoice_hash = invoice_hash.to_lowercase();
        require!(
            invoice_hash.len() == 64 && invoice_hash.bytes().all(|b| b.is_ascii_hexdigit()),
            "invoice_hash must be 32 bytes of hex"
        );
        self.prune_pay_nonces();
        require!(
            self.pay_nonces.contains_key(&invoice_hash)
                || self.pay_nonces.len() < MAX_LIVE_PAY_NONCES,
            "too many live payment nonces"
        );
        self.nonce_counter += 1;
        let nonce = self.next_nonce();
        self.pay_nonces.insert(
            invoice_hash.clone(),
            PayNonce {
                nonce: nonce.clone(),
                expires_at_ms: env::block_timestamp_ms() + PAY_NONCE_TTL_MS,
            },
        );
        emit(
            "pay_nonce_issued",
            &[("invoice_hash", &invoice_hash), ("nonce", &nonce)],
        );
        nonce
    }

    /// Agent key only. Arguments are borsh-encoded in this order. Malformed
    /// calls panic. Once the nonce is consumed the result is `paid` (after the
    /// transfer), `held:<id>`, or `refused: <reason>` with an event, and the
    /// nonce stays consumed. Attach at least 40 Tgas.
    pub fn pay(
        &mut self,
        #[serializer(borsh)] invoice: String,
        #[serializer(borsh)] invoice_sig: Vec<u8>,
        #[serializer(borsh)] response: Vec<u8>,
        #[serializer(borsh)] signature: String,
    ) -> PromiseOrValue<String> {
        self.assert_agent();
        require!(env::prepaid_gas() >= PAY_MIN_GAS, "attach at least 40 Tgas");

        let inv = parse_invoice(&invoice).unwrap_or_else(|e| env::panic_str(&e));
        require!(
            inv.exp > env::block_timestamp_ms() / 1000,
            "invoice expired"
        );
        let merchant = self
            .merchants
            .get(&inv.payee)
            .cloned()
            .unwrap_or_else(|| env::panic_str("payee is not an allowlisted merchant"));
        let sig: [u8; 64] = invoice_sig
            .as_slice()
            .try_into()
            .unwrap_or_else(|_| env::panic_str("invoice signature must be 64 bytes"));
        let merchant_key: [u8; 32] = hex::decode(&merchant.invoice_key)
            .ok()
            .and_then(|k| k.try_into().ok())
            .unwrap_or_else(|| env::panic_str("bad merchant key"));
        require!(
            env::ed25519_verify(&sig, invoice.as_bytes(), &merchant_key),
            "invoice signature is not the merchant's"
        );

        let invoice_hash = hex::encode(env::sha256_array(invoice.as_bytes()));
        let pn = self
            .pay_nonces
            .remove(&invoice_hash)
            .unwrap_or_else(|| env::panic_str("no payment nonce for this invoice"));
        require!(
            pn.expires_at_ms > env::block_timestamp_ms(),
            "payment nonce expired"
        );

        let checked =
            self.check_payment(&inv, &merchant, &invoice, &pn.nonce, &response, &signature);
        let (request_hash, response_hash) = match checked {
            Ok(hashes) => hashes,
            Err((reason, request_hash, response_hash)) => {
                emit(
                    "payment_refused",
                    &[
                        ("invoice_id", &inv.id),
                        ("payee", inv.payee.as_str()),
                        ("amount", &inv.amount.to_string()),
                        ("reason", &reason),
                        ("request_hash", &request_hash),
                        ("response_hash", &response_hash),
                    ],
                );
                return PromiseOrValue::Value(format!("refused: {reason}"));
            }
        };
        self.settled.insert(settled_key(&inv.payee, &inv.id));

        if inv.amount > self.caps.approval_threshold.0 {
            let id = self.next_held_id;
            self.next_held_id += 1;
            self.held.insert(
                id,
                HeldPayment {
                    invoice_id: inv.id.clone(),
                    payee: inv.payee.clone(),
                    amount: U128(inv.amount),
                    request_hash: request_hash.clone(),
                    response_hash: response_hash.clone(),
                    created_at_ms: env::block_timestamp_ms(),
                },
            );
            emit(
                "payment_held",
                &[
                    ("held_id", &id.to_string()),
                    ("invoice_id", &inv.id),
                    ("payee", inv.payee.as_str()),
                    ("amount", &inv.amount.to_string()),
                    ("request_hash", &request_hash),
                    ("response_hash", &response_hash),
                ],
            );
            return PromiseOrValue::Value(format!("held:{id}"));
        }

        emit(
            "payment_sent",
            &[
                ("invoice_id", &inv.id),
                ("payee", inv.payee.as_str()),
                ("amount", &inv.amount.to_string()),
                ("request_hash", &request_hash),
                ("response_hash", &response_hash),
            ],
        );
        PromiseOrValue::Promise(self.transfer(inv.payee, inv.amount, inv.id))
    }

    #[private]
    pub fn on_paid(&mut self, payee: AccountId, amount: U128, invoice_id: String) -> String {
        self.window.pending = U128(self.window.pending.0.saturating_sub(amount.0));
        if !matches!(
            env::promise_result_checked(0, 64),
            Err(near_sdk::PromiseError::Failed)
        ) {
            self.roll_window();
            self.window.spent = U128(self.window.spent.0 + amount.0);
            emit(
                "payment_completed",
                &[
                    ("invoice_id", &invoice_id),
                    ("payee", payee.as_str()),
                    ("amount", &amount.0.to_string()),
                ],
            );
            "paid".to_string()
        } else {
            self.settled.remove(&settled_key(&payee, &invoice_id));
            emit(
                "payment_failed",
                &[
                    ("invoice_id", &invoice_id),
                    ("payee", payee.as_str()),
                    ("amount", &amount.0.to_string()),
                ],
            );
            "failed".to_string()
        }
    }

    /// Owner: pay a held payment. Daily budget and freeze still apply.
    pub fn approve_held(&mut self, held_id: u64) -> Promise {
        self.assert_owner();
        require!(!self.frozen, "wallet is frozen");
        let h = self
            .held
            .remove(&held_id)
            .unwrap_or_else(|| env::panic_str("no such held payment"));
        self.roll_window();
        require!(
            self.window.spent.0 + self.window.pending.0 + h.amount.0 <= self.caps.per_day.0,
            "amount above today's remaining budget"
        );
        emit(
            "held_approved",
            &[
                ("held_id", &held_id.to_string()),
                ("invoice_id", &h.invoice_id),
            ],
        );
        self.transfer(h.payee, h.amount.0, h.invoice_id)
    }

    pub fn reject_held(&mut self, held_id: u64) {
        self.assert_owner();
        let h = self
            .held
            .remove(&held_id)
            .unwrap_or_else(|| env::panic_str("no such held payment"));
        self.settled.remove(&settled_key(&h.payee, &h.invoice_id));
        emit(
            "held_rejected",
            &[
                ("held_id", &held_id.to_string()),
                ("invoice_id", &h.invoice_id),
            ],
        );
    }

    /// Owner: install or rotate the agent's function-call key. The key may only
    /// call `request_nonce` and `pay` on this wallet and cannot attach deposits.
    pub fn set_agent_key(&mut self, public_key: PublicKey, allowance: NearToken) -> Promise {
        self.assert_owner();
        let allowance = near_sdk::Allowance::limited(allowance)
            .unwrap_or_else(|| env::panic_str("allowance must be positive"));
        let me = env::current_account_id();
        let mut p = Promise::new(me.clone());
        if let Some(old) = self.agent_pk.take() {
            p = p.delete_key(old);
        }
        self.agent_pk = Some(public_key.clone());
        emit(
            "agent_key_set",
            &[("public_key", &String::from(&public_key))],
        );
        p.add_access_key_allowance(public_key, allowance, me, AGENT_METHODS)
    }

    pub fn set_policy_template(&mut self, template: PolicyTemplate) {
        self.assert_owner();
        let sample = format!(
            "{}{}{}{}{}",
            template.prefix,
            "0".repeat(64),
            template.middle,
            "inv1|id=0000000000000000|payee=a.near|amount=1|token=usdc|exp=1|memo=x",
            template.suffix
        );
        require!(
            near_sdk::serde_json::from_str::<near_sdk::serde_json::Value>(&sample).is_ok(),
            "template does not form valid JSON around a nonce and invoice"
        );
        require!(
            !template.model_id.is_empty() && !template.model_id.contains(':'),
            "bad model_id"
        );
        self.template = Some(template);
    }

    /// Owner: allowlist a merchant. Any attached deposit is forwarded to the
    /// USDC contract as the merchant's `storage_deposit`, so transfers to it
    /// cannot fail for lack of registration.
    #[payable]
    pub fn add_merchant(
        &mut self,
        account_id: AccountId,
        invoice_key: String,
        cap: U128,
    ) -> PromiseOrValue<()> {
        self.assert_owner();
        let key = invoice_key.trim_start_matches("0x").to_lowercase();
        require!(
            key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit()),
            "invoice_key must be 32 bytes of hex"
        );
        require!(cap.0 > 0, "cap must be positive");
        self.merchants.insert(
            account_id.clone(),
            Merchant {
                invoice_key: key,
                cap,
            },
        );
        emit("merchant_added", &[("account_id", account_id.as_str())]);
        let deposit = env::attached_deposit();
        if deposit.is_zero() {
            return PromiseOrValue::Value(());
        }
        require!(
            env::prepaid_gas() >= ADD_MERCHANT_WITH_DEPOSIT_GAS,
            "attach at least 25 Tgas to register the merchant with USDC"
        );
        PromiseOrValue::Promise(Promise::new(self.usdc.clone()).function_call(
            "storage_deposit",
            near_sdk::serde_json::json!({ "account_id": account_id, "registration_only": true })
                .to_string()
                .into_bytes(),
            deposit,
            STORAGE_DEPOSIT_GAS,
        ))
    }

    pub fn remove_merchant(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.merchants.remove(&account_id);
        emit("merchant_removed", &[("account_id", account_id.as_str())]);
    }

    pub fn set_caps(&mut self, caps: Caps) {
        self.assert_owner();
        require!(
            caps.approval_threshold.0 <= caps.per_payment.0 && caps.per_payment.0 <= caps.per_day.0,
            "need approval_threshold <= per_payment <= per_day"
        );
        self.caps = caps;
    }

    pub fn freeze(&mut self) {
        self.assert_owner();
        self.frozen = true;
        emit("frozen", &[]);
    }

    pub fn unfreeze(&mut self) {
        self.assert_owner();
        self.frozen = false;
        emit("unfrozen", &[]);
    }

    /// Owner: replace this contract's code with the raw wasm passed as input.
    /// The new code must read the existing state layout.
    pub fn update_contract(&mut self) -> Promise {
        self.assert_owner();
        let code = env::input().unwrap_or_else(|| env::panic_str("no code"));
        emit("contract_updated", &[]);
        Promise::new(env::current_account_id()).deploy_contract(code)
    }

    pub fn get_policy_template(&self) -> Option<PolicyTemplate> {
        self.template.clone()
    }

    pub fn get_merchant(&self, account_id: AccountId) -> Option<Merchant> {
        self.merchants.get(&account_id).cloned()
    }

    pub fn get_caps(&self) -> Caps {
        self.caps.clone()
    }

    pub fn get_spend_window(&self) -> SpendWindow {
        self.window.clone()
    }

    pub fn get_held(&self, held_id: u64) -> Option<HeldPayment> {
        self.held.get(&held_id).cloned()
    }

    pub fn get_agent_key(&self) -> Option<PublicKey> {
        self.agent_pk.clone()
    }

    pub fn is_frozen(&self) -> bool {
        self.frozen
    }

    pub fn is_settled(&self, payee: AccountId, invoice_id: String) -> bool {
        self.settled.contains(&settled_key(&payee, &invoice_id))
    }
}

type Refusal = (String, String, String);

impl Symbolon {
    /// Steps 4 to 8: rebuild the request, check the attested signature and the
    /// decision, then the caps. Returns (request_hash, response_hash), or a
    /// refusal reason with the hashes computed so far.
    fn check_payment(
        &mut self,
        inv: &Invoice,
        merchant: &Merchant,
        invoice: &str,
        nonce: &str,
        response: &[u8],
        signature: &str,
    ) -> Result<(String, String), Refusal> {
        let none = || String::new();
        let t = self
            .template
            .clone()
            .ok_or_else(|| ("no policy template set".to_string(), none(), none()))?;
        let mut request = Vec::with_capacity(
            t.prefix.len() + nonce.len() + t.middle.len() + invoice.len() + t.suffix.len(),
        );
        request.extend_from_slice(t.prefix.as_bytes());
        request.extend_from_slice(nonce.as_bytes());
        request.extend_from_slice(t.middle.as_bytes());
        request.extend_from_slice(invoice.as_bytes());
        request.extend_from_slice(t.suffix.as_bytes());
        let rq = hex::encode(env::sha256_array(&request));
        if response.len() > MAX_RESPONSE_LEN {
            return Err(("response too long".into(), rq, none()));
        }
        let rs = hex::encode(env::sha256_array(response));
        let fail = |reason: &str| (reason.to_string(), rq.clone(), rs.clone());

        let signer = recover_eip191_signer(&format!("{}:{}:{}", t.model_id, rq, rs), signature)
            .map_err(|e| fail(&e))?;
        if !self.valid_key(&signer, &t.profile) {
            return Err(fail(
                "decision not signed by an attested model key for this request",
            ));
        }
        let decision = parse_decision(response).map_err(|e| fail(&e))?;
        if !decision.approve {
            return Err(fail("model did not approve this invoice"));
        }
        if decision.payee != inv.payee.as_str()
            || decision.amount != inv.amount.to_string()
            || decision.invoice_id != inv.id
        {
            return Err(fail("decision does not match the invoice"));
        }
        if inv.amount > merchant.cap.0 {
            return Err(fail("amount above this merchant's cap"));
        }
        if inv.amount > self.caps.per_payment.0 {
            return Err(fail("amount above the per-payment cap"));
        }
        if self.settled.contains(&settled_key(&inv.payee, &inv.id)) {
            return Err(fail("invoice already paid or pending"));
        }
        self.roll_window();
        if self.window.spent.0 + self.window.pending.0 + inv.amount > self.caps.per_day.0 {
            return Err(fail("amount above today's remaining budget"));
        }
        Ok((rq, rs))
    }

    fn assert_agent(&self) {
        require!(!self.frozen, "wallet is frozen");
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "agent key only"
        );
        require!(
            self.agent_pk.as_ref() == Some(&env::signer_account_pk()),
            "agent key only"
        );
    }

    fn roll_window(&mut self) {
        let day = env::block_timestamp_ms() / DAY_MS;
        if day != self.window.day {
            self.window.day = day;
            self.window.spent = U128(0);
        }
    }

    fn prune_pay_nonces(&mut self) {
        let now = env::block_timestamp_ms();
        let expired: Vec<String> = self
            .pay_nonces
            .iter()
            .filter(|(_, n)| n.expires_at_ms <= now)
            .map(|(k, _)| k.clone())
            .collect();
        for k in &expired {
            self.pay_nonces.remove(k);
        }
    }

    fn transfer(&mut self, payee: AccountId, amount: u128, invoice_id: String) -> Promise {
        self.window.pending = U128(self.window.pending.0 + amount);
        Promise::new(self.usdc.clone())
            .function_call(
                "ft_transfer",
                near_sdk::serde_json::json!({
                    "receiver_id": payee,
                    "amount": U128(amount),
                    "memo": format!("symbolon invoice {invoice_id}"),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(1),
                FT_TRANSFER_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_PAID_GAS)
                    .on_paid(payee, U128(amount), invoice_id),
            )
    }
}

fn settled_key(payee: &AccountId, invoice_id: &str) -> String {
    format!("{payee}|{invoice_id}")
}

/// `inv1|id=<16 hex>|payee=<account>|amount=<base units>|token=usdc|exp=<unix s>|memo=<text>`
pub fn parse_invoice(s: &str) -> Result<Invoice, String> {
    if s.len() > MAX_INVOICE_LEN {
        return Err("invoice too long".into());
    }
    if !s
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b" |=._:-".contains(&b))
    {
        return Err("invoice has characters outside letters, digits, space and |=._:-".into());
    }
    let parts: Vec<&str> = s.split('|').collect();
    if parts.len() != 7 || parts[0] != "inv1" {
        return Err("invoice must be inv1 with six fields".into());
    }
    let field = |i: usize, name: &str| -> Result<&str, String> {
        parts[i]
            .strip_prefix(name)
            .and_then(|r| r.strip_prefix('='))
            .ok_or_else(|| format!("invoice field {i} must be {name}"))
    };
    let id = field(1, "id")?;
    if id.len() != 16 || !id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return Err("invoice id must be 16 lowercase hex characters".into());
    }
    let payee: AccountId = field(2, "payee")?
        .parse()
        .map_err(|_| "invoice payee is not a valid account".to_string())?;
    let amount_s = field(3, "amount")?;
    if amount_s.is_empty()
        || !amount_s.bytes().all(|b| b.is_ascii_digit())
        || amount_s.starts_with('0')
    {
        return Err("invoice amount must be a positive integer without leading zeros".into());
    }
    let amount: u128 = amount_s
        .parse()
        .map_err(|_| "invoice amount too large".to_string())?;
    if field(4, "token")? != "usdc" {
        return Err("invoice token must be usdc".into());
    }
    let exp_s = field(5, "exp")?;
    if exp_s.is_empty() || !exp_s.bytes().all(|b| b.is_ascii_digit()) {
        return Err("invoice exp must be unix seconds".into());
    }
    let exp: u64 = exp_s
        .parse()
        .map_err(|_| "invoice exp too large".to_string())?;
    let memo = field(6, "memo")?;
    if memo.len() > MAX_MEMO_LEN || !memo.bytes().all(|b| b.is_ascii_alphanumeric() || b == b' ') {
        return Err("invoice memo must be up to 64 letters, digits and spaces".into());
    }
    Ok(Invoice {
        id: id.to_string(),
        payee,
        amount,
        exp,
    })
}

fn parse_decision(response: &[u8]) -> Result<Decision, String> {
    let c: Completion = near_sdk::serde_json::from_slice(response)
        .map_err(|_| "response is not a chat completion".to_string())?;
    let content = c
        .choices
        .into_iter()
        .next()
        .and_then(|ch| ch.message.content)
        .ok_or_else(|| "response has no message content".to_string())?;
    near_sdk::serde_json::from_str(content.trim())
        .map_err(|_| "model content is not a decision object".to_string())
}

/// EIP-191 personal_sign recovery. `signature` is 0x-prefixed hex of r||s||v
/// with v 27 or 28. Returns the signer's address as lowercase hex without 0x.
pub fn recover_eip191_signer(text: &str, signature: &str) -> Result<String, String> {
    let sig = hex::decode(signature.trim_start_matches("0x"))
        .map_err(|_| "signature is not hex".to_string())?;
    if sig.len() != 65 {
        return Err("signature must be 65 bytes".into());
    }
    let v = match sig[64] {
        27 => 0,
        28 => 1,
        _ => return Err("signature v must be 27 or 28".into()),
    };
    let msg = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
    let hash = env::keccak256_array(msg.as_bytes());
    let pk = env::ecrecover(&hash, &sig[..64], v, true)
        .ok_or_else(|| "signature does not recover".to_string())?;
    Ok(hex::encode(&env::keccak256_array(pk)[12..]))
}
