//! Symbolon: an agent wallet that only trusts NEAR AI signing keys whose
//! enclave attestation was verified on-chain.
//!
//! This file holds the attested key registry. Anyone can register a NEAR AI
//! signing key, but only by proving, through NEAR One's on-chain TDX verifier,
//! that the key lives inside a genuine Intel TDX enclave whose measurements
//! the owner has allowlisted, and that the enclave produced the proof after
//! this contract issued a fresh nonce.
//!
//! Report-data layout, MRCONFIGID layout and the debug bit follow NEAR AI's
//! "Quote, Nonce, and Signer Bindings" reference
//! (docs.near.ai/cloud/verification/reference/quote-nonce-signer.md).

use near_sdk::store::{IterableMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PublicKey,
};

pub mod pay;
pub mod verifier;
use pay::{Caps, HeldPayment, Merchant, PayNonce, PolicyTemplate, SpendWindow};
use verifier::{Collateral, QuoteBytes, VerificationResult};

/// Gas for NEAR One's `verify_quote`: 175.81 Tgas burnt measured on mainnet.
const VERIFY_QUOTE_GAS: Gas = Gas::from_tgas(200);
/// Gas reserved for our callback.
const ON_VERIFIED_GAS: Gas = Gas::from_tgas(20);
/// Minimum prepaid gas for `register_attested`: verifier + callback + our own work.
const REGISTER_MIN_GAS: Gas = Gas::from_tgas(240);
/// Upper bound on the verifier result we read back (a TD10 result is 632 bytes).
const MAX_VERIFIER_RESULT: usize = 4096;
/// Non-refundable fee for a nonce, covering its storage and deterring spam.
const NONCE_FEE: NearToken = NearToken::from_millinear(10);
const NONCE_TTL_MS: u64 = 15 * 60 * 1000;
const MAX_APP_COMPOSE_BYTES: usize = 128 * 1024;
/// Expired nonces removed on every `request_attestation_nonce`.
const AUTO_PRUNE: u32 = 2;
/// Entries inspected per prune, so pruning gas stays bounded however many
/// nonces are live. Older entries sit near the front of the map.
const PRUNE_SCAN: usize = 50;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Profiles,
    Keys,
    Nonces,
    Merchants,
    PayNonces,
    Settled,
    Held,
}

/// Measurements the owner accepts for one kind of enclave, for example the
/// `z-ai/glm-5.3-flash` model or the NEAR AI gateway. Hex, lowercase.
/// Every list must be non-empty for the profile to accept anything.
///
/// The profile name is only a label. What ties a profile to a particular
/// model is the `app_compose` file behind each allowlisted compose hash, so
/// the owner must read that file before allowlisting its hash.
#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [json, borsh])]
pub struct MeasurementProfile {
    pub mr_td: Vec<String>,
    pub rt_mr0: Vec<String>,
    pub rt_mr1: Vec<String>,
    pub rt_mr2: Vec<String>,
    /// sha256 of the exact `app_compose` bytes, as bound by MRCONFIGID.
    pub compose_hashes: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [json, borsh])]
pub struct KeyRecord {
    /// Profile the key was attested under.
    pub profile: String,
    pub compose_hash: String,
    pub mr_td: String,
    pub rt_mr0: String,
    pub rt_mr1: String,
    pub rt_mr2: String,
    pub tcb_status: String,
    pub registered_at_ms: u64,
    pub expires_at_ms: u64,
    pub submitter: AccountId,
}

#[derive(Clone, Debug, PartialEq)]
#[near(serializers = [json, borsh])]
pub struct NonceRecord {
    pub expires_at_ms: u64,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Symbolon {
    owner: AccountId,
    /// Set by `propose_owner`; becomes owner on `accept_owner`.
    pending_owner: Option<AccountId>,
    verifier: AccountId,
    accepted_tcb_statuses: Vec<String>,
    key_ttl_ms: u64,
    profiles: IterableMap<String, MeasurementProfile>,
    /// Lowercase hex ECDSA address (no 0x) -> record.
    keys: IterableMap<String, KeyRecord>,
    /// Lowercase hex nonce -> expiry. Expired entries are pruned.
    nonces: IterableMap<String, NonceRecord>,
    nonce_counter: u64,
    #[cfg(feature = "test-nonce")]
    test_next_nonce: Option<String>,
    usdc: AccountId,
    agent_pk: Option<PublicKey>,
    template: Option<PolicyTemplate>,
    merchants: IterableMap<AccountId, Merchant>,
    caps: Caps,
    window: SpendWindow,
    pay_nonces: IterableMap<String, PayNonce>,
    settled: LookupSet<String>,
    held: IterableMap<u64, HeldPayment>,
    next_held_id: u64,
    frozen: bool,
}

#[near]
impl Symbolon {
    #[init]
    pub fn new(owner: AccountId, verifier: AccountId, key_ttl_ms: u64, usdc: AccountId) -> Self {
        require!(key_ttl_ms > 0, "key_ttl_ms must be positive");
        Self {
            owner,
            pending_owner: None,
            verifier,
            accepted_tcb_statuses: vec!["UpToDate".to_string()],
            key_ttl_ms,
            profiles: IterableMap::new(StorageKey::Profiles),
            keys: IterableMap::new(StorageKey::Keys),
            nonces: IterableMap::new(StorageKey::Nonces),
            nonce_counter: 0,
            #[cfg(feature = "test-nonce")]
            test_next_nonce: None,
            usdc,
            agent_pk: None,
            template: None,
            merchants: IterableMap::new(StorageKey::Merchants),
            caps: Caps::default(),
            window: SpendWindow::default(),
            pay_nonces: IterableMap::new(StorageKey::PayNonces),
            settled: LookupSet::new(StorageKey::Settled),
            held: IterableMap::new(StorageKey::Held),
            next_held_id: 0,
            frozen: false,
        }
    }

    // ------------------------------------------------------------------
    // Registration flow
    // ------------------------------------------------------------------

    /// Step 1: get a fresh 32-byte nonce. Fetch a NEAR AI attestation report
    /// with this nonce, then call `register_attested` within 15 minutes.
    #[payable]
    pub fn request_attestation_nonce(&mut self) -> String {
        require!(
            env::attached_deposit() >= NONCE_FEE,
            "attach at least 0.01 NEAR"
        );
        // Each new nonce clears a couple of expired ones, so storage stays bounded.
        self.prune_expired(AUTO_PRUNE);
        self.nonce_counter += 1;
        let nonce = self.next_nonce();
        require!(self.nonces.get(&nonce).is_none(), "nonce collision");
        self.nonces.insert(
            nonce.clone(),
            NonceRecord {
                expires_at_ms: env::block_timestamp_ms() + NONCE_TTL_MS,
            },
        );
        emit("nonce_issued", &[("nonce", &nonce)]);
        nonce
    }

    /// Step 2: submit the enclave's quote. Arguments are borsh-encoded, in this
    /// order, so the quote and collateral reach the verifier byte for byte.
    /// Attach at least 240 Tgas.
    pub fn register_attested(
        &mut self,
        #[serializer(borsh)] profile: String,
        #[serializer(borsh)] signing_address: String,
        #[serializer(borsh)] quote: QuoteBytes,
        #[serializer(borsh)] collateral: Collateral,
        #[serializer(borsh)] app_compose: String,
    ) -> Promise {
        require!(
            env::prepaid_gas() >= REGISTER_MIN_GAS,
            "attach at least 240 Tgas"
        );
        let address = normalize_address(&signing_address);
        let p = self.profiles.get(&profile).unwrap_or_else(|| {
            env::panic_str("unknown profile");
        });
        require!(
            app_compose.len() <= MAX_APP_COMPOSE_BYTES,
            "app_compose too large"
        );
        // Cheap checks first, so a bad submission does not spend verifier gas.
        let compose_hash = hex::encode(env::sha256_array(app_compose.as_bytes()));
        require!(
            p.compose_hashes.contains(&compose_hash),
            "compose hash not allowlisted for this profile"
        );

        let args = borsh::to_vec(&(quote, collateral)).expect("borsh");
        Promise::new(self.verifier.clone())
            .function_call(
                "verify_quote".to_string(),
                args,
                NearToken::from_yoctonear(0),
                VERIFY_QUOTE_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_VERIFIED_GAS)
                    .on_attestation_verified(
                        profile,
                        address,
                        compose_hash,
                        env::predecessor_account_id(),
                    ),
            )
    }

    /// Callback: every post-verifier check lives here. Returns true when the
    /// key was registered. Never panics on a bad proof, so the rejection
    /// reason is logged as an event.
    #[private]
    pub fn on_attestation_verified(
        &mut self,
        profile: String,
        address: String,
        compose_hash: String,
        submitter: AccountId,
    ) -> bool {
        let checked = self
            .check_verifier_result(&profile, &address, &compose_hash)
            .and_then(|ok| match self.keys.get(&address) {
                Some(existing) if existing.profile != profile => {
                    Err("address already registered under another profile".to_string())
                }
                _ => Ok(ok),
            });
        match checked {
            Ok(m) => {
                let now = env::block_timestamp_ms();
                let record = KeyRecord {
                    profile: profile.clone(),
                    compose_hash,
                    mr_td: m.mr_td,
                    rt_mr0: m.rt_mr0,
                    rt_mr1: m.rt_mr1,
                    rt_mr2: m.rt_mr2,
                    tcb_status: m.tcb_status,
                    registered_at_ms: now,
                    expires_at_ms: now + self.key_ttl_ms,
                    submitter,
                };
                self.keys.insert(address.clone(), record);
                emit(
                    "key_registered",
                    &[("address", &address), ("profile", &profile)],
                );
                true
            }
            Err(reason) => {
                emit(
                    "key_rejected",
                    &[
                        ("address", &address),
                        ("profile", &profile),
                        ("reason", &reason),
                    ],
                );
                false
            }
        }
    }

    /// Anyone can remove up to `limit` expired nonces. Returns how many were removed.
    pub fn prune_expired_nonces(&mut self, limit: u32) -> u32 {
        self.prune_expired(limit.min(100))
    }

    // ------------------------------------------------------------------
    // Owner
    // ------------------------------------------------------------------

    pub fn set_profile(&mut self, profile: String, measurements: MeasurementProfile) {
        self.assert_owner();
        let m = MeasurementProfile {
            mr_td: lower_all(measurements.mr_td, 48),
            rt_mr0: lower_all(measurements.rt_mr0, 48),
            rt_mr1: lower_all(measurements.rt_mr1, 48),
            rt_mr2: lower_all(measurements.rt_mr2, 48),
            compose_hashes: lower_all(measurements.compose_hashes, 32),
        };
        self.profiles.insert(profile, m);
    }

    /// Two-step handover, for example to a multisig or Sputnik DAO.
    pub fn propose_owner(&mut self, new_owner: AccountId) {
        self.assert_owner();
        emit("owner_proposed", &[("new_owner", new_owner.as_str())]);
        self.pending_owner = Some(new_owner);
    }

    pub fn accept_owner(&mut self) {
        let caller = env::predecessor_account_id();
        require!(
            self.pending_owner.as_ref() == Some(&caller),
            "only the proposed owner can accept"
        );
        self.owner = caller;
        self.pending_owner = None;
        emit("owner_changed", &[("owner", self.owner.as_str())]);
    }

    /// Point at a different TDX verifier, for example when NEAR One deploys a
    /// new dated verifier account. Existing keys keep their records.
    pub fn set_verifier(&mut self, verifier: AccountId) {
        self.assert_owner();
        emit("verifier_changed", &[("verifier", verifier.as_str())]);
        self.verifier = verifier;
    }

    pub fn remove_profile(&mut self, profile: String) {
        self.assert_owner();
        self.profiles.remove(&profile);
    }

    pub fn set_accepted_tcb_statuses(&mut self, statuses: Vec<String>) {
        self.assert_owner();
        require!(!statuses.is_empty(), "need at least one status");
        self.accepted_tcb_statuses = statuses;
    }

    pub fn set_key_ttl_ms(&mut self, key_ttl_ms: u64) {
        self.assert_owner();
        require!(key_ttl_ms > 0, "key_ttl_ms must be positive");
        self.key_ttl_ms = key_ttl_ms;
    }

    pub fn revoke_key(&mut self, address: String) {
        self.assert_owner();
        let a = normalize_address(&address);
        self.keys.remove(&a);
        emit("key_revoked", &[("address", &a)]);
    }

    /// Test builds only: fix the next nonce so a captured report can be replayed.
    #[cfg(feature = "test-nonce")]
    pub fn test_set_next_nonce(&mut self, nonce: String) {
        self.assert_owner();
        self.test_next_nonce = Some(nonce.to_lowercase());
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    pub fn get_key(&self, address: String) -> Option<KeyRecord> {
        self.keys.get(&normalize_address(&address)).cloned()
    }

    /// True when the address was attested under `profile`, has not expired, and
    /// every measurement it was attested with is still on the profile's allowlist.
    pub fn is_key_valid(&self, address: String, profile: String) -> bool {
        self.valid_key(&normalize_address(&address), &profile)
    }

    pub fn get_profile(&self, profile: String) -> Option<MeasurementProfile> {
        self.profiles.get(&profile).cloned()
    }

    pub fn get_pending_owner(&self) -> Option<AccountId> {
        self.pending_owner.clone()
    }

    pub fn get_config(&self) -> (AccountId, AccountId, Vec<String>, u64) {
        (
            self.owner.clone(),
            self.verifier.clone(),
            self.accepted_tcb_statuses.clone(),
            self.key_ttl_ms,
        )
    }
}

impl Symbolon {
    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    pub(crate) fn valid_key(&self, address: &str, profile: &str) -> bool {
        let Some(k) = self.keys.get(address) else {
            return false;
        };
        if k.profile != profile || k.expires_at_ms <= env::block_timestamp_ms() {
            return false;
        }
        // Policy changes apply at once: a key is only as good as the
        // measurements it was attested with are still allowlisted.
        let Some(p) = self.profiles.get(profile) else {
            return false;
        };
        p.compose_hashes.contains(&k.compose_hash)
            && p.mr_td.contains(&k.mr_td)
            && p.rt_mr0.contains(&k.rt_mr0)
            && p.rt_mr1.contains(&k.rt_mr1)
            && p.rt_mr2.contains(&k.rt_mr2)
    }

    fn prune_expired(&mut self, limit: u32) -> u32 {
        let now = env::block_timestamp_ms();
        let expired: Vec<String> = self
            .nonces
            .iter()
            .take(PRUNE_SCAN)
            .filter(|(_, n)| n.expires_at_ms <= now)
            .take(limit as usize)
            .map(|(k, _)| k.clone())
            .collect();
        for k in &expired {
            self.nonces.remove(k);
        }
        expired.len() as u32
    }

    pub(crate) fn next_nonce(&mut self) -> String {
        #[cfg(feature = "test-nonce")]
        if let Some(n) = self.test_next_nonce.take() {
            return n;
        }
        let mut seed = env::random_seed_array().to_vec();
        seed.extend_from_slice(&env::block_height().to_le_bytes());
        seed.extend_from_slice(&self.nonce_counter.to_le_bytes());
        seed.extend_from_slice(env::current_account_id().as_bytes());
        hex::encode(env::sha256_array(&seed))
    }

    /// Reads the verifier result, runs every post-verifier check, and only
    /// then consumes the nonce. Returns the attested measurements or a reason.
    fn check_verifier_result(
        &mut self,
        profile: &str,
        address: &str,
        compose_hash: &str,
    ) -> Result<Attested, String> {
        let bytes = env::promise_result_checked(0, MAX_VERIFIER_RESULT)
            .map_err(|_| "verifier call failed or result too long".to_string())?;
        let result = VerificationResult::try_from_slice_exact(&bytes)?;
        let p = self
            .profiles
            .get(profile)
            .ok_or_else(|| "profile removed during verification".to_string())?;
        let (attested, nonce) = evaluate_report(
            result,
            &self.accepted_tcb_statuses,
            p,
            address,
            compose_hash,
        )?;
        let n = self.nonces.remove(&nonce).ok_or_else(|| {
            "nonce was not issued by this contract or was already used".to_string()
        })?;
        if n.expires_at_ms <= env::block_timestamp_ms() {
            return Err("nonce expired".into());
        }
        Ok(attested)
    }
}

/// Every check on the verifier's answer that needs no contract state.
/// Returns the attested measurements and the nonce found in report_data.
pub fn evaluate_report(
    result: VerificationResult,
    accepted_tcb_statuses: &[String],
    p: &MeasurementProfile,
    address: &str,
    compose_hash: &str,
) -> Result<(Attested, String), String> {
    let report = match result {
        VerificationResult::Verified(r) => r,
        VerificationResult::Rejected(e) => return Err(format!("verifier rejected: {e:?}")),
    };
    if !accepted_tcb_statuses.contains(&report.status) {
        return Err(format!("tcb status {} not accepted", report.status));
    }
    let td = report
        .report
        .as_td10()
        .ok_or_else(|| "not a TDX report".to_string())?;
    // TD_ATTRIBUTES bit 0 is the DEBUG flag.
    if td.td_attributes[0] & 1 != 0 {
        return Err("TDX debug mode enabled".into());
    }

    // report_data = signer address zero-padded to 32 bytes || nonce
    let addr_bytes = hex::decode(address).map_err(|_| "bad address hex".to_string())?;
    if addr_bytes.len() != 20 {
        return Err("address must be 20 bytes".into());
    }
    let mut bound = [0u8; 32];
    bound[..20].copy_from_slice(&addr_bytes);
    if td.report_data[..32] != bound {
        return Err("report_data does not bind this signing address".into());
    }

    // MRCONFIGID = 0x01 || sha256(app_compose) || 15 zero bytes
    let hash = hex::decode(compose_hash).map_err(|_| "bad compose hash".to_string())?;
    if hash.len() != 32 {
        return Err("compose hash must be 32 bytes".into());
    }
    let mut expected = [0u8; 48];
    expected[0] = 1;
    expected[1..33].copy_from_slice(&hash);
    if td.mr_config_id != expected {
        return Err("MRCONFIGID does not match app_compose".into());
    }

    let check = |name: &str, list: &Vec<String>, value: &[u8]| -> Result<(), String> {
        if list.contains(&hex::encode(value)) {
            Ok(())
        } else {
            Err(format!("{name} not allowlisted"))
        }
    };
    check("mr_td", &p.mr_td, &td.mr_td)?;
    check("rt_mr0", &p.rt_mr0, &td.rt_mr0)?;
    check("rt_mr1", &p.rt_mr1, &td.rt_mr1)?;
    check("rt_mr2", &p.rt_mr2, &td.rt_mr2)?;
    if !p.compose_hashes.iter().any(|h| h == compose_hash) {
        return Err("compose hash not allowlisted".into());
    }
    Ok((
        Attested {
            tcb_status: report.status,
            mr_td: hex::encode(td.mr_td),
            rt_mr0: hex::encode(td.rt_mr0),
            rt_mr1: hex::encode(td.rt_mr1),
            rt_mr2: hex::encode(td.rt_mr2),
        },
        hex::encode(&td.report_data[32..]),
    ))
}

#[derive(Debug, PartialEq)]
pub struct Attested {
    pub tcb_status: String,
    pub mr_td: String,
    pub rt_mr0: String,
    pub rt_mr1: String,
    pub rt_mr2: String,
}

trait TryFromSliceExact: Sized {
    fn try_from_slice_exact(bytes: &[u8]) -> Result<Self, String>;
}

impl<T: borsh::BorshDeserialize> TryFromSliceExact for T {
    fn try_from_slice_exact(bytes: &[u8]) -> Result<Self, String> {
        borsh::from_slice(bytes).map_err(|e| format!("cannot decode verifier result: {e}"))
    }
}

/// Lowercase, strip 0x, require a 20-byte ECDSA address.
fn normalize_address(a: &str) -> String {
    let s = a
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_lowercase();
    require!(
        s.len() == 40 && s.bytes().all(|c| c.is_ascii_hexdigit()),
        "signing address must be 20 bytes of hex"
    );
    s
}

fn lower_all(v: Vec<String>, bytes: usize) -> Vec<String> {
    require!(!v.is_empty(), "every measurement list must be non-empty");
    v.into_iter()
        .map(|s| {
            let s = s.trim().trim_start_matches("0x").to_lowercase();
            require!(
                s.len() == bytes * 2 && s.bytes().all(|c| c.is_ascii_hexdigit()),
                "bad measurement hex length"
            );
            s
        })
        .collect()
}

/// NEP-297 event with one data object of string fields, all JSON-escaped.
pub(crate) fn emit(event: &str, fields: &[(&str, &str)]) {
    let data = fields
        .iter()
        .map(|(k, v)| format!("{}:{}", json_str(k), json_str(v)))
        .collect::<Vec<_>>()
        .join(",");
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"symbolon\",\"version\":\"1.0.0\",\"event\":{},\"data\":[{{{data}}}]}}",
        json_str(event)
    ));
}

/// Quote and escape a string for JSON (RFC 8259 section 7).
pub fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Cases no real NEAR AI quote can produce. Everything a real quote can
/// reach is covered by the sandbox tests in tests/registry.rs instead.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::verifier::*;

    const ADDR: &str = "3b753b4406613c5e70ae640508632b600424fa0c";
    const NONCE: [u8; 32] = [7u8; 32];
    const COMPOSE: [u8; 32] = [9u8; 32];

    fn td10() -> TDReport10 {
        let mut report_data = [0u8; 64];
        report_data[..20].copy_from_slice(&hex::decode(ADDR).unwrap());
        report_data[32..].copy_from_slice(&NONCE);
        let mut mr_config_id = [0u8; 48];
        mr_config_id[0] = 1;
        mr_config_id[1..33].copy_from_slice(&COMPOSE);
        TDReport10 {
            tee_tcb_svn: [0; 16],
            mr_seam: [0; 48],
            mr_signer_seam: [0; 48],
            seam_attributes: [0; 8],
            td_attributes: [0; 8],
            xfam: [0; 8],
            mr_td: [1; 48],
            mr_config_id,
            mr_owner: [0; 48],
            mr_owner_config: [0; 48],
            rt_mr0: [2; 48],
            rt_mr1: [3; 48],
            rt_mr2: [4; 48],
            rt_mr3: [5; 48],
            report_data,
        }
    }

    fn verified(report: Report) -> VerificationResult {
        let ok = TcbStatusWithAdvisory {
            status: TcbStatus::UpToDate,
            advisory_ids: vec![],
        };
        VerificationResult::Verified(VerifiedReport {
            status: "UpToDate".to_string(),
            advisory_ids: vec![],
            report,
            ppid: vec![],
            qe_status: ok.clone(),
            platform_status: ok,
        })
    }

    fn profile() -> MeasurementProfile {
        MeasurementProfile {
            mr_td: vec![hex::encode([1u8; 48])],
            rt_mr0: vec![hex::encode([2u8; 48])],
            rt_mr1: vec![hex::encode([3u8; 48])],
            rt_mr2: vec![hex::encode([4u8; 48])],
            compose_hashes: vec![hex::encode(COMPOSE)],
        }
    }

    fn run(
        result: VerificationResult,
        p: &MeasurementProfile,
    ) -> Result<(Attested, String), String> {
        evaluate_report(
            result,
            &["UpToDate".to_string()],
            p,
            ADDR,
            &hex::encode(COMPOSE),
        )
    }

    #[test]
    fn accepts_td15_through_its_td10_base() {
        let r = Report::TD15(TDReport15 {
            base: td10(),
            tee_tcb_svn2: [0; 16],
            mr_service_td: [0; 48],
        });
        let (_, nonce) = run(verified(r), &profile()).unwrap();
        assert_eq!(nonce, hex::encode(NONCE));
    }

    #[test]
    fn rejects_sgx_report() {
        let sgx = EnclaveReport {
            cpu_svn: [0; 16],
            misc_select: 0,
            reserved1: [0; 28],
            attributes: [0; 16],
            mr_enclave: [0; 32],
            reserved2: [0; 32],
            mr_signer: [0; 32],
            reserved3: [0; 96],
            isv_prod_id: 0,
            isv_svn: 0,
            reserved4: [0; 60],
            report_data: [0; 64],
        };
        let e = run(verified(Report::SgxEnclave(sgx)), &profile()).unwrap_err();
        assert_eq!(e, "not a TDX report");
    }

    #[test]
    fn rejects_debug_mode() {
        let mut t = td10();
        t.td_attributes[0] = 1;
        let e = run(verified(Report::TD10(t)), &profile()).unwrap_err();
        assert_eq!(e, "TDX debug mode enabled");
    }

    #[test]
    fn rejects_nonzero_padding_after_address() {
        let mut t = td10();
        t.report_data[25] = 1;
        let e = run(verified(Report::TD10(t)), &profile()).unwrap_err();
        assert_eq!(e, "report_data does not bind this signing address");
    }

    #[test]
    fn rejects_runtime_measurements_missing_from_allowlist() {
        let cases: [(&str, fn(&mut MeasurementProfile)); 3] = [
            ("rt_mr0 not allowlisted", |p| {
                p.rt_mr0 = vec![hex::encode([0xaa; 48])]
            }),
            ("rt_mr1 not allowlisted", |p| {
                p.rt_mr1 = vec![hex::encode([0xaa; 48])]
            }),
            ("rt_mr2 not allowlisted", |p| {
                p.rt_mr2 = vec![hex::encode([0xaa; 48])]
            }),
        ];
        for (want, mutate) in cases {
            let mut p = profile();
            mutate(&mut p);
            let e = run(verified(Report::TD10(td10())), &p).unwrap_err();
            assert_eq!(e, want);
        }
    }

    #[test]
    fn json_str_escapes_quotes_backslashes_and_controls() {
        assert_eq!(json_str(r#"a"b\c"#), r#""a\"b\\c""#);
        assert_eq!(json_str("x\ny\u{1}"), "\"x\\ny\\u0001\"");
        let v: serde_json::Value =
            serde_json::from_str(&format!("{{\"r\":{}}}", json_str("dcap \\ \"bad\"\n"))).unwrap();
        assert_eq!(v["r"], "dcap \\ \"bad\"\n");
    }
}
