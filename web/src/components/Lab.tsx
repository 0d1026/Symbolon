import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CASES, CAPTURED_AT, POLICY, type LabCase } from "../data/signed";
import { MODEL_KEY, PROFILE, WALLET } from "../data/chain";
import { b64ToBytes, merchantSigOk, readDecision, readInvoice, rebuildRequest, recoverSigner, sha256Hex, type Decision } from "../lib/verify";
import { usdc, view } from "../lib/near";
import { Token } from "./Token";
import { TLink } from "./TLink";

type Fields = { invoice: string; nonce: string; response: string; signature: string };
type Caps = { per_payment: string; per_day: string; approval_threshold: string };
type KeyState = "idle" | "wait" | "valid" | "invalid" | "error";
type Status = "pass" | "fail" | "skip" | "wait";
type Step = { key: string; title: string; status: Status; detail?: ReactNode };
type Verdict = { kind: "paid" | "held" | "refused" | "pending"; text: string };

const fromCase = (c: LabCase): Fields => ({ invoice: c.invoice, nonce: c.nonce, response: c.response, signature: c.signature });

function HashDiff({ a, b }: { a: string; b: string }) {
  return (
    <span className="hash">
      {a.split("").map((ch, i) => (
        <i key={i} className={ch === b[i] ? "eq" : "ne"}>{ch}</i>
      ))}
    </span>
  );
}

/** Everything that can be computed without the network, in the contract's order. */
function compute(c: LabCase, f: Fields) {
  const merchantOk = merchantSigOk(f.invoice, c.invoiceSig);
  const rq = sha256Hex(rebuildRequest(f.nonce, f.invoice));
  const rs = sha256Hex(f.response);
  const seen = sha256Hex(b64ToBytes(c.seenRequestB64));
  let signer: string | null = null;
  let signerErr = "";
  try {
    signer = recoverSigner(`${POLICY.model_id}:${rq}:${rs}`, f.signature);
  } catch (e) {
    // Library errors (bad curve point and so on) all mean what the contract says: it does not recover.
    const m = e instanceof Error ? e.message : "";
    signerErr = /65 bytes|must be 27 or 28|not hex/.test(m) ? m.replace("not hex", "signature is not hex") : "signature does not recover";
  }
  let decision: Decision | null = null;
  let decisionErr = "";
  try {
    decision = readDecision(f.response);
  } catch (e) {
    decisionErr = e instanceof Error ? e.message : "decision could not be read";
  }
  return { merchantOk, rq, rs, seen, signer, signerErr, decision, decisionErr, inv: readInvoice(f.invoice) };
}

export default function Lab() {
  const [caseId, setCaseId] = useState(CASES[0].id);
  const c = CASES.find((x) => x.id === caseId)!;
  const [f, setF] = useState<Fields>(fromCase(CASES[0]));
  const [keyState, setKeyState] = useState<KeyState>("idle");
  const [caps, setCaps] = useState<Caps | null>(null);

  const r = useMemo(() => compute(c, f), [c, f]);
  const modified = f.invoice !== c.invoice || f.nonce !== c.nonce || f.response !== c.response || f.signature !== c.signature;

  const pick = (id: string) => {
    const next = CASES.find((x) => x.id === id)!;
    setCaseId(id);
    setF(fromCase(next));
  };

  // Live: ask testnet whether the recovered signer is an attested key (debounced).
  useEffect(() => {
    if (!r.signer) { setKeyState("idle"); return; }
    setKeyState("wait");
    let live = true;
    const t = setTimeout(() => {
      view<boolean>(WALLET, "is_key_valid", { address: r.signer, profile: PROFILE })
        .then((v) => live && setKeyState(v ? "valid" : "invalid"))
        .catch(() => live && setKeyState("error"));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [r.signer]);

  // Live: the owner's current caps.
  useEffect(() => {
    let live = true;
    view<Caps>(WALLET, "get_caps").then((v) => live && setCaps(v)).catch(() => {});
    return () => { live = false; };
  }, []);

  const { steps, verdict } = useMemo(() => {
    const out: Step[] = [];
    let stop: Verdict | null = null;
    const add = (key: string, title: string, ok: boolean | null, detail: ReactNode, reason: string) => {
      if (stop) { out.push({ key, title, status: "skip" }); return; }
      if (ok === null) { out.push({ key, title, status: "wait", detail }); stop = { kind: "pending", text: "Waiting for testnet…" }; return; }
      out.push({ key, title, status: ok ? "pass" : "fail", detail });
      if (!ok) stop = { kind: "refused", text: reason };
    };

    add("sig", "The merchant signed this invoice", r.merchantOk,
      <span className="mono">ed25519 check against the merchant key</span>, "invoice signature is not the merchant's");

    add("req", "Rebuild the request from the owner's template", true,
      <>
        <span className="lab-k">Signed by the model</span>
        <span className="mono lab-h">{r.seen}</span>
        <span className="lab-k">Rebuilt by the wallet</span>
        <span className="mono lab-h"><HashDiff a={r.rq} b={r.seen} /></span>
      </>, "");

    add("hash", "Hash the response", true, <span className="mono lab-h">{r.rs}</span>, "");

    add("rec", "Recover who signed it", r.signer ? true : false,
      <>
        <span className="mono lab-h">{r.signer ?? r.signerErr}</span>
        {r.signer && <span className={r.signer === MODEL_KEY ? "lab-tag good" : "lab-tag bad"}>{r.signer === MODEL_KEY ? "the attested NEAR AI key" : "not the attested key"}</span>}
      </>, "refused: " + (r.signerErr || "signature does not recover"));

    const keyOk = keyState === "valid" ? true : keyState === "invalid" ? false : keyState === "error" ? false : null;
    add("key", "Is that signer an attested key? (asks testnet)", keyOk,
      <span className="mono">{keyState === "error" ? "Could not reach testnet RPC" : `${WALLET}.is_key_valid(signer)`}</span>,
      keyState === "error" ? "could not reach testnet to check the key" : "refused: decision not signed by an attested model key for this request");

    add("dec", "Read the decision", r.decision ? r.decision.approve : false,
      r.decision ? <span className="mono">approve: {String(r.decision.approve)} · {usdc(r.decision.amount)} USDC · id {r.decision.invoice_id}</span> : <span className="mono">{r.decisionErr}</span>,
      r.decision ? "refused: model did not approve this invoice" : "refused: " + r.decisionErr);

    const matches = !!(r.decision && r.inv && r.decision.payee === r.inv.payee && r.decision.amount === r.inv.amount && r.decision.invoice_id === r.inv.id);
    add("match", "The decision is for this exact invoice", matches,
      <span className="mono">payee, amount and invoice id must all equal the invoice</span>, "refused: decision does not match the invoice");

    let tail: Verdict | null = null;
    if (!stop) {
      const amount = r.inv ? BigInt(r.inv.amount) : 0n;
      if (!caps) { out.push({ key: "caps", title: "Spending caps (live from testnet)", status: "wait" }); tail = { kind: "pending", text: "Reading the owner's caps…" }; }
      else if (amount > BigInt(caps.per_payment)) { out.push({ key: "caps", title: "Spending caps (live from testnet)", status: "fail", detail: <span className="mono">{usdc(amount)} USDC is above the per-payment cap of {usdc(caps.per_payment)}</span> }); tail = { kind: "refused", text: "refused: amount above the per-payment cap" }; }
      else if (amount > BigInt(caps.approval_threshold)) { out.push({ key: "caps", title: "Spending caps (live from testnet)", status: "pass", detail: <span className="mono">{usdc(amount)} USDC is above the {usdc(caps.approval_threshold)} approval threshold</span> }); tail = { kind: "held", text: "Held for the owner to approve" }; }
      else { out.push({ key: "caps", title: "Spending caps (live from testnet)", status: "pass", detail: <span className="mono">{usdc(amount)} USDC is within every cap</span> }); tail = { kind: "paid", text: `Pays ${usdc(amount)} USDC` }; }
    } else {
      out.push({ key: "caps", title: "Spending caps (live from testnet)", status: "skip" });
    }
    return { steps: out, verdict: (stop ?? tail) as Verdict };
  }, [r, keyState, caps]);

  const ok = verdict.kind === "paid" || verdict.kind === "held";

  // Tamper helpers act on the raw text, exactly as an attacker would.
  const tamper = {
    amount: () => setF((p) => ({ ...p, response: p.response.replace(/(\\"amount\\": \\")(\d+)(\\")/, (_m, a, _n, z) => `${a}9000000${z}`) })),
    approve: () => setF((p) => ({ ...p, response: p.response.replace(/(\\"approve\\": )(true|false)/, (_m, a, v) => `${a}${v === "true" ? "false" : "true"}`) })),
    nonce: () => setF((p) => ({ ...p, nonce: p.nonce.slice(0, -1) + (p.nonce.endsWith("0") ? "1" : "0") })),
    sig: () => setF((p) => ({ ...p, signature: p.signature.slice(0, 12) + (p.signature[12] === "a" ? "b" : "a") + p.signature.slice(13) })),
  };

  return (
    <div className="lab">
      <div className="lab-head">
        <div className="seg" role="tablist" aria-label="Scenario">
          {CASES.map((x) => (
            <button key={x.id} role="tab" aria-selected={x.id === caseId} className={x.id === caseId ? "on" : ""} onClick={() => pick(x.id)}>{x.title}</button>
          ))}
        </div>
        <p className="lab-blurb">{c.blurb}</p>
      </div>

      <div className="lab-grid">
        <div className="lab-l">
          <div className="lab-tools">
            <span className="mono lab-k">Tamper with it</span>
            <button className="btn btn-sm btn-ghost" onClick={tamper.amount}><span>Amount to 9 USDC</span></button>
            <button className="btn btn-sm btn-ghost" onClick={tamper.approve}><span>Flip approve</span></button>
            <button className="btn btn-sm btn-ghost" onClick={tamper.nonce}><span>Edit the nonce</span></button>
            <button className="btn btn-sm btn-ghost" onClick={tamper.sig}><span>Edit the signature</span></button>
            <button className="btn btn-sm" onClick={() => setF(fromCase(c))} disabled={!modified}><span>Reset</span></button>
          </div>

          <label className="lab-field"><span className="mono">Invoice</span>
            <input value={f.invoice} onChange={(e) => setF({ ...f, invoice: e.target.value })} spellCheck={false} />
          </label>
          <label className="lab-field"><span className="mono">Nonce</span>
            <input value={f.nonce} onChange={(e) => setF({ ...f, nonce: e.target.value })} spellCheck={false} />
          </label>
          <label className="lab-field"><span className="mono">Model response</span>
            <textarea value={f.response} onChange={(e) => setF({ ...f, response: e.target.value })} rows={9} spellCheck={false} />
          </label>
          <label className="lab-field"><span className="mono">Signature</span>
            <input value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} spellCheck={false} />
          </label>
        </div>

        <div className="lab-r">
          <div className={`lverdict ${verdict.kind}`} aria-live="polite">
            <div className="lv-token"><Token state={ok ? "match" : verdict.kind === "pending" ? "idle" : "break"} /></div>
            <div>
              <small className="mono">{modified ? "After your changes" : "As recorded"}</small>
              <b>{verdict.text}</b>
            </div>
          </div>

          <ol className="lsteps">
            {steps.map((s, i) => (
              <li key={s.key} className={`lstep ${s.status}`}>
                <span className="ls-n mono" aria-hidden="true">{s.status === "pass" ? "✓" : s.status === "fail" ? "✕" : s.status === "wait" ? "…" : String(i + 1)}</span>
                <div>
                  <h4>{s.title}</h4>
                  {s.status !== "skip" && s.detail && (s.status === "fail" || s.key === "req" || s.key === "rec") && <div className="ls-d">{s.detail}</div>}
                  {s.status === "skip" && <div className="ls-d dim small">Not reached. The contract stops at the first failure.</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <details className="lab-note">
        <summary className="mono">What is real here?</summary>
        <p className="dim small">Real NEAR AI signatures, captured 2026-11-07. Hashing and signer recovery run in your browser. The attested-key check and the caps are read live from testnet. No transaction is sent, so the allowlist and nonce state are not simulated. The <TLink to="/attacks" className="tx">attacks page</TLink> shows those on testnet.</p>
      </details>
    </div>
  );
}
