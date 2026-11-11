//! Benchmark: legitimate payments against attack attempts, in the sandbox,
//! with the real verifier, the real attested key and the captured NEAR AI
//! decisions from 2026-11-07. No keys, no network to NEAR AI.
//!
//! Every sample runs in its own sandbox, because a paid or refused invoice can
//! never be submitted to the same wallet again.
//!
//! Build first: `./scripts/build.sh`. Run:
//! `cargo test --test benchmark -- --ignored --nocapture`
//! Size: `BENCH_LEGIT=100 BENCH_ATTACKS=100` (default 20 and 20).
//! Writes `../docs/benchmark.json` and `../docs/benchmark.md`.

mod common;
use common::pay::*;
use near_workspaces::result::ExecutionFinalResult;
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;

/// Attack types, in the order they are cycled. `held` is a legitimate large
/// payment that must wait for the owner; it is counted apart from blocks.
const ATTACKS: [&str; 7] = [
    "forged_decision",
    "tampered_response",
    "replay",
    "stolen_key",
    "injection_pay_attacker",
    "injection_outside_mandate",
    "held_large_payment",
];

#[derive(Clone, serde::Serialize)]
struct Sample {
    kind: String,
    /// paid, held, blocked, or LEAKED (an attack that paid)
    outcome: String,
    detail: String,
    /// total gas burnt by the attempt's transaction, all receipts
    gas_total: u64,
    /// gas burnt in receipts executed on the wallet account
    gas_wallet: u64,
    nonce_ms: u128,
    pay_ms: u128,
    setup_ms: u128,
}

fn gas_of(out: &ExecutionFinalResult, wallet: &str) -> (u64, u64) {
    let wallet_gas = out
        .receipt_outcomes()
        .iter()
        .filter(|o| o.executor_id.as_str() == wallet)
        .map(|o| o.gas_burnt.as_gas())
        .sum();
    (out.total_gas_burnt.as_gas(), wallet_gas)
}

/// Runs one pay() and classifies it.
async fn attempt(p: &PayEnv, s: &Submission, who: &near_workspaces::Account) -> anyhow::Result<(String, String, u64, u64, u128)> {
    let t = Instant::now();
    let out = p.pay_as(who, s, 100).await?;
    let ms = t.elapsed().as_millis();
    let (g, w) = gas_of(&out, p.e.wallet.id().as_str());
    let (outcome, detail) = match out.into_result() {
        Ok(v) => {
            let r: String = v.json()?;
            let o = if r == "paid" {
                "paid"
            } else if r.starts_with("held:") {
                "held"
            } else {
                "blocked"
            };
            (o.to_string(), r)
        }
        Err(e) => ("blocked".into(), format!("tx failed: {}", short(&format!("{e:?}")))),
    };
    Ok((outcome, detail, g, w, ms))
}

fn short(s: &str) -> String {
    for k in ["no payment nonce", "MethodNameMismatch", "not allowlisted", "owner only", "Smart contract panicked"] {
        if let Some(i) = s.find(k) {
            return s[i..].chars().take(90).take_while(|c| *c != '"').collect();
        }
    }
    s.chars().take(90).collect()
}

async fn run(kind: &'static str) -> anyhow::Result<Sample> {
    let t0 = Instant::now();
    let p = pay_env().await?;
    let setup_ms = t0.elapsed().as_millis();
    let mut nonce_ms = 0;

    macro_rules! with_nonce {
        ($name:expr, $inv:expr) => {{
            let t = Instant::now();
            p.issue_pay_nonce($name, $inv).await?;
            nonce_ms = t.elapsed().as_millis();
        }};
    }

    let (outcome, detail, g, w, pay_ms) = match kind {
        "legit" => {
            let s = p.submission("market_data", "market_data");
            with_nonce!("market_data", &s.invoice);
            attempt(&p, &s, &p.agent).await?
        }
        "forged_decision" => {
            let s = p.submission("gift_cards", "attacker_forged");
            with_nonce!("gift_cards", &s.invoice);
            attempt(&p, &s, &p.agent).await?
        }
        "tampered_response" => {
            let mut s = p.submission("market_data", "market_data");
            let text = String::from_utf8(s.response.clone())?;
            s.response = text
                .replacen(r#"\"amount\": \"2000000\""#, r#"\"amount\": \"9000000\""#, 1)
                .into_bytes();
            with_nonce!("market_data", &s.invoice);
            attempt(&p, &s, &p.agent).await?
        }
        "replay" => {
            // honest payment first (not measured), then resubmit it
            let s = p.submission("market_data", "market_data");
            p.issue_pay_nonce("market_data", &s.invoice).await?;
            anyhow::ensure!(p.pay(&s).await?.0 == "paid", "replay setup payment failed");
            attempt(&p, &s, &p.agent).await?
        }
        "stolen_key" => {
            // agent key used on an owner method: rejected by the access key rules
            let t = Instant::now();
            let res = p
                .agent
                .call(p.e.wallet.id(), "set_caps")
                .args_json(json!({ "caps": { "approval_threshold": "1", "per_payment": "999999999999", "per_day": "999999999999" } }))
                .transact()
                .await;
            let ms = t.elapsed().as_millis();
            match res {
                Ok(out) => {
                    let (g, w) = gas_of(&out, p.e.wallet.id().as_str());
                    let ok = out.is_success();
                    (if ok { "LEAKED" } else { "blocked" }.into(), short(&format!("{:?}", out.into_result().err())), g, w, ms)
                }
                Err(e) => ("blocked".into(), format!("tx rejected: {}", short(&format!("{e:?}"))), 0, 0, ms),
            }
        }
        "injection_pay_attacker" => {
            // fooled agent submits an invoice to a non-allowlisted payee
            let inv = &p.d.invoices["outsider"];
            let s = Submission {
                invoice: inv.invoice.clone(),
                invoice_sig: hex::decode(&inv.invoice_sig)?,
                response: p.d.cases["market_data"].response.0.clone(),
                signature: p.d.cases["market_data"].signature.clone(),
            };
            let t = Instant::now();
            let n = p
                .agent
                .call(p.e.wallet.id(), "request_nonce")
                .args_json(json!({ "invoice_hash": sha256_hex(s.invoice.as_bytes()) }))
                .transact()
                .await?;
            nonce_ms = t.elapsed().as_millis();
            if n.is_success() {
                attempt(&p, &s, &p.agent).await?
            } else {
                let (g, w) = gas_of(&n, p.e.wallet.id().as_str());
                ("blocked".into(), format!("request_nonce: {}", short(&format!("{:?}", n.into_result().err()))), g, w, 0)
            }
        }
        "injection_outside_mandate" => {
            let s = p.submission("gift_cards", "gift_cards");
            with_nonce!("gift_cards", &s.invoice);
            attempt(&p, &s, &p.agent).await?
        }
        "held_large_payment" => {
            let s = p.submission("large_report", "large_report");
            with_nonce!("large_report", &s.invoice);
            attempt(&p, &s, &p.agent).await?
        }
        _ => unreachable!(),
    };

    // an attack that paid is a leak; legit that did not pay is a failure
    let outcome = if kind != "legit" && kind != "held_large_payment" && outcome == "paid" {
        "LEAKED".to_string()
    } else {
        outcome
    };
    Ok(Sample { kind: kind.into(), outcome, detail, gas_total: g, gas_wallet: w, nonce_ms, pay_ms, setup_ms })
}

fn stats(v: &mut Vec<f64>) -> (f64, f64, f64) {
    if v.is_empty() {
        return (0.0, 0.0, 0.0);
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean = v.iter().sum::<f64>() / v.len() as f64;
    let p = |q: f64| v[((v.len() as f64 - 1.0) * q).round() as usize];
    (mean, p(0.5), p(0.95))
}

#[tokio::test]
#[ignore = "benchmark: cargo test --test benchmark -- --ignored --nocapture"]
async fn benchmark() -> anyhow::Result<()> {
    let n_legit: usize = std::env::var("BENCH_LEGIT").ok().and_then(|v| v.parse().ok()).unwrap_or(20);
    let n_att: usize = std::env::var("BENCH_ATTACKS").ok().and_then(|v| v.parse().ok()).unwrap_or(20);
    let par: usize = std::env::var("BENCH_PARALLEL").ok().and_then(|v| v.parse().ok()).unwrap_or(3);

    let mut kinds: Vec<&'static str> = vec!["legit"; n_legit];
    kinds.extend((0..n_att).map(|i| ATTACKS[i % ATTACKS.len()]));

    let sem = Arc::new(tokio::sync::Semaphore::new(par));
    let started = Instant::now();
    let mut set = tokio::task::JoinSet::new();
    for (i, k) in kinds.iter().copied().enumerate() {
        let sem = sem.clone();
        set.spawn(async move {
            let _g = sem.acquire_owned().await;
            (i, run(k).await)
        });
    }
    let mut samples: Vec<Option<Sample>> = vec![None; kinds.len()];
    while let Some(r) = set.join_next().await {
        let (i, s) = r?;
        let s = s.map_err(|e| anyhow::anyhow!("sample {i} ({}) errored: {e:?}", kinds[i]))?;
        eprintln!("{:>3} {:<26} {:<8} {}", i, s.kind, s.outcome, s.detail);
        samples[i] = Some(s);
    }
    let samples: Vec<Sample> = samples.into_iter().map(Option::unwrap).collect();
    let wall = started.elapsed().as_secs_f64();

    // summary rows per kind
    let mut order: Vec<&str> = vec!["legit"];
    order.extend(ATTACKS.iter().copied().filter(|a| samples.iter().any(|s| s.kind == *a)));
    let mut rows = vec![];
    let mut md = String::new();
    md.push_str("| Kind | Runs | Paid | Held | Blocked | Leaked | Rate | pay() gas total, Tgas (mean) | wallet receipts, Tgas (mean) | request_nonce ms p50 | pay ms p50 / p95 |\n");
    md.push_str("| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |\n");
    for k in &order {
        let ss: Vec<&Sample> = samples.iter().filter(|s| s.kind == *k).collect();
        let c = |o: &str| ss.iter().filter(|s| s.outcome == o).count();
        let (paid, held, blocked, leaked) = (c("paid"), c("held"), c("blocked"), c("LEAKED"));
        let n = ss.len();
        let rate = match *k {
            "legit" => format!("{:.0}% paid", 100.0 * paid as f64 / n as f64),
            "held_large_payment" => format!("{:.0}% held", 100.0 * held as f64 / n as f64),
            _ => format!("{:.0}% blocked", 100.0 * blocked as f64 / n as f64),
        };
        let (gt, _, _) = stats(&mut ss.iter().map(|s| s.gas_total as f64 / 1e12).collect());
        let (gw, _, _) = stats(&mut ss.iter().map(|s| s.gas_wallet as f64 / 1e12).collect());
        let (_, nm, _) = stats(&mut ss.iter().filter(|s| s.nonce_ms > 0).map(|s| s.nonce_ms as f64).collect());
        let (_, pm, p95) = stats(&mut ss.iter().map(|s| s.pay_ms as f64).collect());
        let reason = ss.first().map(|s| s.detail.clone()).unwrap_or_default();
        md.push_str(&format!(
            "| {k} | {n} | {paid} | {held} | {blocked} | {leaked} | {rate} | {gt:.2} | {gw:.2} | {nm:.0} | {pm:.0} / {p95:.0} |\n"
        ));
        rows.push(json!({ "kind": k, "runs": n, "paid": paid, "held": held, "blocked": blocked, "leaked": leaked,
            "gas_total_tgas_mean": gt, "gas_wallet_tgas_mean": gw, "nonce_ms_p50": nm, "pay_ms_p50": pm, "pay_ms_p95": p95, "result": reason }));
    }
    let legit_paid = samples.iter().filter(|s| s.kind == "legit" && s.outcome == "paid").count();
    let leaks = samples.iter().filter(|s| s.outcome == "LEAKED").count();
    let att_blocked = samples.iter().filter(|s| s.kind != "legit" && s.kind != "held_large_payment" && s.outcome == "blocked").count();
    let att_total = samples.iter().filter(|s| s.kind != "legit" && s.kind != "held_large_payment").count();
    let held = samples.iter().filter(|s| s.kind == "held_large_payment" && s.outcome == "held").count();
    let held_total = samples.iter().filter(|s| s.kind == "held_large_payment").count();

    let mut results = String::from("| Kind | What happened (first run) |\n| --- | --- |\n");
    for r in &rows {
        results.push_str(&format!("| {} | `{}` |\n", r["kind"].as_str().unwrap(), r["result"].as_str().unwrap().replace('|', "\\|")));
    }
    let doc = format!(
        "# Benchmark\n\nSandbox run: real NEAR One verifier code, the real attested NEAR AI key and the NEAR AI decisions captured on 2026-11-07, mock USDC. No keys and no network calls to NEAR AI. Each sample runs in a fresh sandbox, because a paid or refused invoice can never reach the same wallet again.\n\nRerun: `./scripts/build.sh && cd contract && cargo test --test benchmark -- --ignored --nocapture`. Size: `BENCH_LEGIT=100 BENCH_ATTACKS=100`.\n\n## Summary\n\n- Legitimate payments paid: {legit_paid}/{n_legit}\n- Attacks blocked: {att_blocked}/{att_total}; leaked: {leaks}\n- Large payments held for the owner (not counted as blocked): {held}/{held_total}\n- Wall time: {wall:.0} s with {par} sandboxes in parallel\n\n## Per kind\n\n{md}\nGas is `total_gas_burnt` of the measured transaction, which includes the USDC transfer and the `on_paid` callback on paid runs; \"wallet receipts\" counts only receipts executed on the wallet account. `stolen_key` is rejected by the NEAR protocol before execution (`MethodNameMismatch`), so it burns no contract gas. `replay` resubmits a paid invoice without a new nonce; only the resubmission is measured. Latency is sandbox time (a local node with fast blocks), not testnet time, and does not include the NEAR AI call: the decisions are captured.\n\n{results}"
    );
    std::fs::write("../docs/benchmark.md", doc)?;
    std::fs::write(
        "../docs/benchmark.json",
        serde_json::to_string_pretty(&json!({ "mode": "sandbox", "fixtures": DECISIONS, "legit": n_legit, "attacks": n_att,
            "wall_s": wall, "parallel": par, "summary": rows, "samples": samples }))?,
    )?;
    println!("\n{md}");
    anyhow::ensure!(leaks == 0, "{leaks} attack(s) paid");
    anyhow::ensure!(legit_paid == n_legit, "only {legit_paid}/{n_legit} legitimate payments paid");
    Ok(())
}
