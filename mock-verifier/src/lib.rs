//! Sandbox-only stand-in for NEAR One's TDX verifier.
//!
//! `verify_quote` ignores its input and returns whatever borsh bytes were set
//! with `set_answer`. Tests use it to hand Symbolon verifier answers that no
//! genuine quote can produce, such as a report with TDX debug mode on, and
//! check that Symbolon's own post-verifier checks refuse them on-chain.
//! Never deploy this outside a sandbox.

use near_sdk::{env, near};

#[derive(Default)]
#[near(contract_state)]
pub struct MockVerifier {
    answer: Vec<u8>,
}

#[near]
impl MockVerifier {
    /// Store the raw borsh bytes of a `VerificationResult`, base64-encoded.
    pub fn set_answer(&mut self, answer_base64: near_sdk::json_types::Base64VecU8) {
        self.answer = answer_base64.into();
    }

    /// Same name as the real verifier's method. Returns the preset bytes raw.
    pub fn verify_quote(&self) {
        env::value_return(&self.answer);
    }
}
