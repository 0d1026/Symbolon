import { useEffect, useState } from "react";
import { view, viewKeys, usdc } from "../lib/near";
import { MERCHANT, MODEL_KEY, PROFILE, SNAPSHOT, USDC, WALLET } from "../data/chain";
import { Reveal, Rise } from "../components/Reveal";
import { CountUp } from "../components/Bits";

type Live = {
  caps: { per_payment: string; per_day: string; approval_threshold: string };
  spend: { day: number; spent: string; pending: string };
  frozen: boolean;
  agentKey: string | null;
  merchant: { invoice_key: string; cap: string } | null;
  keyValid: boolean;
  balance: string;
  held: Record<number, { payee: string; amount: string; invoice_id: string } | null>;
  fullAccessKeys: number;
  functionCallKeys: number;
};

async function load(): Promise<Live> {
  const r = await Promise.all([
    view<Live["caps"]>(WALLET, "get_caps"),
    view<Live["spend"]>(WALLET, "get_spend_window"),
    view<boolean>(WALLET, "is_frozen"),
    view<string | null>(WALLET, "get_agent_key"),
    view<Live["merchant"]>(WALLET, "get_merchant", { account_id: MERCHANT }),
    view<boolean>(WALLET, "is_key_valid", { address: MODEL_KEY, profile: PROFILE }),
    view<string>(USDC, "ft_balance_of", { account_id: WALLET }),
    view<Live["held"][number]>(WALLET, "get_held", { held_id: 0 }),
    view<Live["held"][number]>(WALLET, "get_held", { held_id: 1 }),
    viewKeys(WALLET),
  ]);
  const full = r[9].keys.filter((k) => k.access_key.permission === "FullAccess").length;
  return { caps: r[0], spend: r[1], frozen: r[2], agentKey: r[3], merchant: r[4], keyValid: r[5], balance: r[6], held: { 0: r[7], 1: r[8] }, fullAccessKeys: full, functionCallKeys: r[9].keys.length - full };
}

function Ruler({ caps }: { caps: Live["caps"] }) {
  const max = Number(caps.per_day) / 1e6;
  const th = Number(caps.approval_threshold) / 1e6;
  const pp = Number(caps.per_payment) / 1e6;
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="ruler" role="img" aria-label={`Payments up to ${th} USDC pay automatically, up to ${pp} are held for the owner, above ${pp} are refused`}>
      <div className="rz auto" style={{ width: pct(th) }}><b>Pays itself</b><small className="mono">0 to {th}</small></div>
      <div className="rz held" style={{ width: `calc(${pct(pp)} - ${pct(th)})` }}><b>Waits for owner</b><small className="mono">{th} to {pp}</small></div>
      <div className="rz refuse" style={{ width: `calc(100% - ${pct(pp)})` }}><b>Refused per payment</b><small className="mono">{pp}+</small></div>
      <div className="ticks mono"><span style={{ left: 0 }}>0</span><span style={{ left: pct(th) }}>{th}</span><span style={{ left: pct(pp) }}>{pp}</span><span style={{ right: 0 }}>{max} / day</span></div>
    </div>
  );
}

function SettledLookup() {
  const [payee, setPayee] = useState(MERCHANT);
  const [id, setId] = useState("");
  const [res, setRes] = useState<string>("");
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    setRes("…");
    try {
      const v = await view<boolean>(WALLET, "is_settled", { payee, invoice_id: id });
      setRes(v ? "Settled: this invoice was paid." : "Not settled for this payee and invoice id.");
    } catch (er) { setRes(er instanceof Error ? er.message : "Lookup failed"); }
  };
  return (
    <form className="lookup" onSubmit={ask}>
      <label><span className="mono">Payee</span><input value={payee} onChange={(e) => setPayee(e.target.value)} spellCheck={false} /></label>
      <label><span className="mono">Invoice id</span><input value={id} onChange={(e) => setId(e.target.value)} placeholder="the id inside the invoice" spellCheck={false} /></label>
      <button className="btn btn-sm" type="submit" disabled={!id}><span>Check</span></button>
      {res && <p className="lookup-out mono" aria-live="polite">{res}</p>}
    </form>
  );
}

export default function Wallet() {
  const [d, setD] = useState<Live | null>(null);
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    let live = true;
    load().then((r) => live && setD(r)).catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, []);

  const snap = !d && err;
  const caps = d?.caps ?? (snap ? SNAPSHOT.caps : null);
  const num = (u: string) => Number(BigInt(u)) / 1e6;
  const spent = d ? num(d.spend.spent) : 0;
  const perDay = caps ? num(caps.per_day) : 0;

  return (
    <main className="page">
      <header className="phead">
        <span className="eyebrow mono">Read-only · public views</span>
        <Reveal as="h1" text="The wallet,|*as the chain sees it.*" wait />
        <div className="status mono">
          {d && <span className="badge live"><i className="dot" /> Live from testnet RPC</span>}
          {!d && !err && <span className="badge"><i className="dot dim" /> Asking the chain…</span>}
          {snap && <span className="badge warn">RPC unreachable · showing repo snapshot from {SNAPSHOT.date}</span>}
          <span>{WALLET}</span>
        </div>
      </header>

      {caps && (
        <section className="sec">
          <span className="eyebrow mono">Spending rules</span>
          <Ruler caps={caps} />
          <div className="stats">
            <Rise><div className="stat"><small className="mono">Approval threshold</small><b><CountUp to={num(caps.approval_threshold)} /> <i>USDC</i></b><p>Above this, the owner decides.</p></div></Rise>
            <Rise delay={0.07}><div className="stat"><small className="mono">Per payment</small><b><CountUp to={num(caps.per_payment)} /> <i>USDC</i></b><p>Per payment limit.</p></div></Rise>
            <Rise delay={0.14}><div className="stat"><small className="mono">Per UTC day</small><b><CountUp to={perDay} /> <i>USDC</i></b><p>{d ? `${usdc(d.spend.spent)} spent, ${usdc(d.spend.pending)} pending today` : "Daily total across all merchants."}</p></div></Rise>
          </div>
          {d && perDay > 0 && (
            <div className="daybar" role="img" aria-label={`${spent} of ${perDay} USDC used today`}>
              <i style={{ width: `${Math.min(100, (spent / perDay) * 100)}%` }} />
            </div>
          )}
        </section>
      )}

      <section className="sec grid2">
        <Rise>
          <div className="panel">
            <h3>Trust</h3>
            <ul className="kv">
              <li><span>Frozen</span><b className={d ? (d.frozen ? "bad" : "good") : ""}>{d ? (d.frozen ? "Yes" : "No") : "…"}</b></li>
              <li><span>Model key {MODEL_KEY.slice(0, 6)}…{MODEL_KEY.slice(-4)}</span><b className={d ? (d.keyValid ? "good" : "bad") : ""}>{d ? (d.keyValid ? "Attested & valid" : "Not valid") : "…"}</b></li>
              <li><span>Profile</span><b className="mono">{PROFILE}</b></li>
              <li><span>Access keys on the wallet</span><b className={d ? (d.fullAccessKeys ? "warnc" : "good") : ""}>{d ? `${d.functionCallKeys} limited, ${d.fullAccessKeys} full access` : "…"}</b></li>
              <li><span>Agent key</span><b className="mono wrap">{d ? (d.agentKey ?? "none") : snap ? SNAPSHOT.agent_key : "…"}</b></li>
            </ul>
            <p className="note">The agent key can only call <code>request_nonce</code> and <code>pay</code>. The full-access key is the testnet deployment key.</p>
          </div>
        </Rise>
        <Rise delay={0.08}>
          <div className="panel">
            <h3>Money</h3>
            <ul className="kv">
              <li><span>USDC in the wallet</span><b>{d ? usdc(d.balance) : snap ? usdc(SNAPSHOT.usdc_balance) : "…"}</b></li>
              <li><span>Allowlisted merchant</span><b className="mono wrap">{MERCHANT}</b></li>
              <li><span>Merchant cap</span><b>{d?.merchant ? `${usdc(d.merchant.cap)} USDC` : snap ? `${usdc(SNAPSHOT.merchant_cap)} USDC` : "…"}</b></li>
              <li><span>Held payments (ids 0, 1)</span><b>{d ? (Object.values(d.held).filter(Boolean).length ? "Waiting for owner" : "None waiting") : "…"}</b></li>
            </ul>
                      </div>
        </Rise>
      </section>

      <section className="sec">
        <span className="eyebrow mono">Look up an invoice</span>
        <h2 className="h2s">Was it <em>settled?</em></h2>
        <SettledLookup />
      </section>
    </main>
  );
}
