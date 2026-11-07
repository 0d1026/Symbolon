#!/usr/bin/env bash
# Builds two wasm files:
#   target/near/symbolon.wasm        production build (no test features)
#   target/near/test/symbolon.wasm   sandbox-test build (`test-nonce` enabled)
set -euo pipefail
cd "$(dirname "$0")/../contract"
cargo near build non-reproducible-wasm --locked --no-abi --out-dir ../target/near
cargo near build non-reproducible-wasm --locked --no-abi --features test-nonce --out-dir ../target/near/test
ls -l ../target/near/symbolon.wasm ../target/near/test/symbolon.wasm
# Sandbox-only fake verifier used by tests/mock_verifier.rs
(cd ../mock-verifier && cargo near build non-reproducible-wasm --locked --no-abi --out-dir ../target/near/mock)
ls -l ../target/near/mock/mock_verifier.wasm
