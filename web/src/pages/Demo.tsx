import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap, reduced } from "../lib/motion";
import { Reveal } from "../components/Reveal";
import { Tx } from "../components/Bits";
import Lab from "../components/Lab";

const LANES = [
  { k: "merchant", t: "Merchant", x: 90 },
  { k: "agent", t: "AI agent", x: 290 },
  { k: "model", t: "NEAR AI model", x: 490 },
  { k: "wallet", t: "Wallet", x: 690 },
];
const X = Object.fromEntries(LANES.map((l) => [l.k, l.x]));

const STEPS: { from: string; to: string; label: string; log: string[] }[] = [
  { from: "agent", to: "merchant", label: "GET /data/market-feed", log: ["agent  → GET /data/market-feed"] },
  { from: "merchant", to: "agent", label: "402 + signed invoice", log: ["merchant ← 402 PAYMENT-REQUIRED", "  x402 v2, one option: an invoice signed with the merchant's ed25519 key"] },
  { from: "agent", to: "wallet", label: "request_nonce", log: ["agent → v2.symbolon.testnet.request_nonce(invoice_hash)", "  signed by the function-call key; the nonce is single use"] },
  { from: "agent", to: "model", label: "policy request + nonce + invoice", log: ["agent → NEAR AI: owner's template, nonce, invoice", "  non-streaming, temperature 0, JSON schema output"] },
  { from: "model", to: "agent", label: "decision, signed in the TEE", log: ["model ← {\"approve\":true, payee, amount, invoice_id}", "  provider_tee signature over sha256(request) and sha256(response)", "  agent checks the hashes against its own bytes before spending gas"] },
  { from: "agent", to: "wallet", label: "pay(invoice, response, signature)", log: ["agent → wallet.pay(…)", "  wallet: merchant signature ✓  rebuilt request ✓  attested signer ✓", "  approve:true for this invoice ✓  caps ✓  → ft_transfer 2 USDC"] },
  { from: "agent", to: "merchant", label: "retry + PAYMENT-SIGNATURE", log: ["agent → GET /data/market-feed", "  PAYMENT-SIGNATURE: the transaction hash"] },
  { from: "merchant", to: "agent", label: "200 + data", log: ["merchant reads the tx from RPC: pay returned “paid”,", "  USDC ft_transfer wallet → merchant, memo “symbolon invoice <id>”", "merchant ← 200 + PAYMENT-RESPONSE", "  invoice id recorded as served"] },
];

export default function Demo() {
  const [i, setI] = useState(-1);
  const [play, setPlay] = useState(true);
  const [tab, setTab] = useState<"lab" | "replay">("lab");
  const svg = useRef<SVGSVGElement>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab !== "replay" || !play) return;
    if (i >= STEPS.length - 1) { setPlay(false); return; }
    const id = setTimeout(() => setI((n) => n + 1), i < 0 ? 900 : 2300);
    return () => clearTimeout(id);
  }, [i, play, tab]);

  useLayoutEffect(() => {
    if (tab !== "replay" || i < 0 || !svg.current) return;
    const g = svg.current.querySelector(`#arrow-${i}`);
    if (!g) return;
    if (reduced()) { gsap.set(g, { opacity: 1 }); return; }
    const line = g.querySelector("line");
    const len = line ? (line as SVGLineElement).getTotalLength() : 0;
    const tl = gsap.timeline();
    tl.set(g, { opacity: 1 })
      .fromTo(line, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.8, ease: "power3.inOut" })
      .fromTo(g.querySelectorAll(".lbl"), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.5 }, "<0.3");
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    return () => { tl.kill(); };
  }, [i, tab]);

  const reset = () => { setI(-1); setPlay(true); };
  const step = STEPS[Math.max(i, 0)];
  const y = (n: number) => 130 + n * 62;

  return (
    <main className="page">
      <header className="phead">
        <span className="eyebrow mono">Live in your browser</span>
        <Reveal as="h1" text="Run it,|*then break it.*" wait />
        <p className="lede">Take a real signed decision from NEAR AI, change one character, and watch the wallet's checks catch it. Or replay a recorded HTTP 402 purchase.</p>
        <div className="seg demo-tabs" role="tablist" aria-label="Demo mode">
          <button role="tab" aria-selected={tab === "lab"} className={tab === "lab" ? "on" : ""} onClick={() => setTab("lab")}>Break it yourself</button>
          <button role="tab" aria-selected={tab === "replay"} className={tab === "replay" ? "on" : ""} onClick={() => setTab("replay")}>Recorded purchase</button>
        </div>
      </header>
      {tab === "lab" && <Lab />}
      {tab === "replay" && (
      <section className="demo">
        <div className="demo-stage">
          <svg ref={svg} viewBox="0 0 780 660" role="img" aria-label="Sequence diagram of the purchase">
            <defs>
              <marker id="da" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L10 5 L0 10 z" fill="#7ad3b0" />
              </marker>
            </defs>
            {LANES.map((l) => (
              <g key={l.k}>
                <text x={l.x} y="44" textAnchor="middle" className="lane-t">{l.t}</text>
                <line x1={l.x} y1="62" x2={l.x} y2="640" className="lane" />
                <circle cx={l.x} cy="62" r="4" className="lane-dot" />
              </g>
            ))}
            {STEPS.map((s, n) => {
              const a = X[s.from], b = X[s.to];
              const left = Math.min(a, b);
              return (
                <g key={n} id={`arrow-${n}`} style={{ opacity: 0 }} className={n === i ? "now" : ""}>
                  <line x1={a} y1={y(n)} x2={b + (b > a ? -6 : 6)} y2={y(n)} className="arrow" markerEnd="url(#da)" />
                  <text x={left + Math.abs(b - a) / 2} y={y(n) - 10} textAnchor="middle" className="lbl">{`${n + 1}. ${s.label}`}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <aside className="demo-side">
          <div className="ctl">
            <button className="btn btn-sm" onClick={() => setPlay((p) => !p)}><span>{play ? "Pause" : i >= STEPS.length - 1 ? "Finished" : "Play"}</span></button>
            <button className="btn btn-sm btn-ghost" onClick={() => { setPlay(false); setI((n) => Math.min(STEPS.length - 1, n + 1)); }} disabled={i >= STEPS.length - 1}><span>Next step</span></button>
            <button className="btn btn-sm btn-ghost" onClick={reset}><span>Restart</span></button>
          </div>
          <div className="term" ref={log} aria-live="polite">
            <div className="term-bar mono"><i /><i /><i /><span>agent.ts buy</span></div>
            <div className="term-body mono">
              {i < 0 && <p className="dim">Waiting for the first request…</p>}
              {STEPS.slice(0, i + 1).map((s, n) => (
                <div key={n} className={n === i ? "tl now" : "tl"}>
                  <b>{String(n + 1).padStart(2, "0")}</b>
                  <div>{s.log.map((l, k) => <p key={k}>{l}</p>)}</div>
                </div>
              ))}
            </div>
          </div>
          {i >= STEPS.length - 1 && (
            <div className="done">
              <b>Purchase settled.</b>
              <p>Real transaction of this flow on testnet: <Tx id="2kj5MfBXPovzF39nCWQqxRNJ7ESc7QPxGSG2rWNmhox5" /></p>
            </div>
          )}
          <p className="dim small">Step {Math.max(i + 1, 0)} of {STEPS.length}. This is a walkthrough of the recorded flow, not a live run. {i >= 0 ? `Now: ${step.label}.` : ""}</p>
        </aside>
      </section>
      )}
    </main>
  );
}
