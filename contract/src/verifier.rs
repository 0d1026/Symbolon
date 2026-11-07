//! Borsh types spoken at the boundary of NEAR One's TDX verifier contract
//! (`tee-verifier-2026-08-04.near`, code hash
//! `6RHv9Er2kDegVjCDcHaBvpbgjmgq5nAHodyBiHC4gZpa`).
//!
//! Field-for-field copy of `tee-verifier-interface` from github.com/near/mpc.
//! On 2026-11-07 we decoded a full `verify_quote` result from the deployed
//! contract with exactly this layout (632 of 632 bytes consumed).

use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct QuoteBytes(pub Vec<u8>);

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct Collateral {
    pub pck_crl_issuer_chain: String,
    pub root_ca_crl: Vec<u8>,
    pub pck_crl: Vec<u8>,
    pub tcb_info_issuer_chain: String,
    pub tcb_info: String,
    pub tcb_info_signature: Vec<u8>,
    pub qe_identity_issuer_chain: String,
    pub qe_identity: String,
    pub qe_identity_signature: Vec<u8>,
    pub pck_certificate_chain: Option<String>,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct VerifiedReport {
    pub status: String,
    pub advisory_ids: Vec<String>,
    pub report: Report,
    pub ppid: Vec<u8>,
    pub qe_status: TcbStatusWithAdvisory,
    pub platform_status: TcbStatusWithAdvisory,
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub enum Report {
    SgxEnclave(EnclaveReport),
    TD10(TDReport10),
    TD15(TDReport15),
    TD15Ex(TDReport15Ex),
}

impl Report {
    pub fn as_td10(&self) -> Option<&TDReport10> {
        match self {
            Report::TD10(r) => Some(r),
            Report::TD15(r) => Some(&r.base),
            Report::TD15Ex(r) => Some(&r.base.base),
            Report::SgxEnclave(_) => None,
        }
    }
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct TDReport15Ex {
    pub base: TDReport15,
    pub vmid: u8,
    pub td_id: [u8; 32],
    pub dev_info: [u8; 48],
    pub init_service_td_hash: [u8; 48],
    pub init_service_td_attributes: [u8; 8],
    pub init_cpu_svn: [u8; 16],
    pub init_tee_tcb_svn: [u8; 16],
    pub init_tee_fmspc: [u8; 12],
    pub cur_service_td_hash: [u8; 48],
    pub cur_service_td_attributes: [u8; 8],
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct TDReport10 {
    pub tee_tcb_svn: [u8; 16],
    pub mr_seam: [u8; 48],
    pub mr_signer_seam: [u8; 48],
    pub seam_attributes: [u8; 8],
    pub td_attributes: [u8; 8],
    pub xfam: [u8; 8],
    pub mr_td: [u8; 48],
    pub mr_config_id: [u8; 48],
    pub mr_owner: [u8; 48],
    pub mr_owner_config: [u8; 48],
    pub rt_mr0: [u8; 48],
    pub rt_mr1: [u8; 48],
    pub rt_mr2: [u8; 48],
    pub rt_mr3: [u8; 48],
    pub report_data: [u8; 64],
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct TDReport15 {
    pub base: TDReport10,
    pub tee_tcb_svn2: [u8; 16],
    pub mr_service_td: [u8; 48],
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct EnclaveReport {
    pub cpu_svn: [u8; 16],
    pub misc_select: u32,
    pub reserved1: [u8; 28],
    pub attributes: [u8; 16],
    pub mr_enclave: [u8; 32],
    pub reserved2: [u8; 32],
    pub mr_signer: [u8; 32],
    pub reserved3: [u8; 96],
    pub isv_prod_id: u16,
    pub isv_svn: u16,
    pub reserved4: [u8; 60],
    pub report_data: [u8; 64],
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub enum TcbStatus {
    UpToDate,
    OutOfDateConfigurationNeeded,
    OutOfDate,
    ConfigurationAndSWHardeningNeeded,
    ConfigurationNeeded,
    SWHardeningNeeded,
    Revoked,
    TDRelaunchAdvised,
    TDRelaunchAdvisedConfigurationNeeded,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub struct TcbStatusWithAdvisory {
    pub status: TcbStatus,
    pub advisory_ids: Vec<String>,
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub enum VerifierError {
    DcapVerification(String),
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize, PartialEq, Eq)]
pub enum VerificationResult {
    Verified(VerifiedReport),
    Rejected(VerifierError),
}
