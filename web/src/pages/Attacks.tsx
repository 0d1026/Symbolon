import { useParams, Navigate } from "react-router-dom";
import { ATTACKS } from "../data/attacks";
import { Reveal, Rise } from "../components/Reveal";
import { AttackRows } from "./Home";
import { Tx, CountUp } from "../components/Bits";
import { TLink } from "../components/TLink";
import { Token } from "../components/Token";

const LIMITS = [
  ["Shared model key", "One key serves every instance of a model."],
  ["Fooled agent", "A fooled agent can still spend up to the caps."],
  ["Retries", "A compromised agent can ask the model many times and submit the best answer."],
  ["Not checked on chain", "GPU evidence and the RTMR3 event log."],
  ["Decisions are public", "Selective disclosure, not privacy."],
  ["Daily cap", "Resets at UTC midnight, so up to twice the cap can move across it."],
];

export default function Attacks() {
  return (
    <main className="page">
      <header className="phead">
        <span className="eyebrow mono">Threat model · testnet · 2026-11-07</span>
        <Reveal as="h1" text="Six attacks,|*zero* for the attacker." wait />
        <p className="lede">Run on testnet. Every transaction is linked.</p>
      </header>
      <AttackRows full />
      <section className="sec balances">
        <span className="eyebrow mono">USDC before and after, recorded 2026-11-07</span>
        <div className="bal">
          <div><small className="mono">symbolon-attacker.testnet</small><b><CountUp to={0} /> <i>→</i> <CountUp to={0} /></b><span>no change</span></div>
          <div><small className="mono">symbolon-merchant.testnet</small><b>4 <i>→</i> 56</b><span>+52, both approved</span></div>
          <div><small className="mono">v2.symbolon.testnet</small><b>996 <i>→</i> 944</b><span>−52, to the merchant</span></div>
        </div>
      </section>
      <section className="sec limits">
        <span className="eyebrow mono">What these tests don't cover</span>
        <h2>Limits, <em>stated plainly.</em></h2>
        <dl className="limit-list">
          {LIMITS.map(([k, v]) => (
            <Rise key={k}><div><dt>{k}</dt><dd>{v}</dd></div></Rise>
          ))}
        </dl>
      </section>
    </main>
  );
}

export function AttackDetail() {
  const { slug } = useParams();
  const i = ATTACKS.findIndex((a) => a.slug === slug);
  if (i < 0) return <Navigate to="/attacks" replace />;
  const a = ATTACKS[i];
  const next = ATTACKS[(i + 1) % ATTACKS.length];
  return (
    <main className="page">
      <header className="phead">
        <TLink to="/attacks" className="back mono">← All attacks</TLink>
        <span className="eyebrow mono">Attack {a.n} of 06</span>
        <Reveal as="h1" text={a.name} wait />
      </header>
      <section className="trio">
        <Rise><div><small className="mono">What the attacker did</small><p>{a.did}</p></div></Rise>
        <Rise delay={0.08}><div><small className="mono">What stopped it</small><p>{a.stopped}</p></div></Rise>
        <Rise delay={0.16}><div><small className="mono">USDC moved</small><p className="big">{a.moved}</p></div></Rise>
      </section>
      <section className="sec detail">
        <div className="detail-l">
          {a.story.map((p, k) => <Rise key={k}><p className="story">{p}</p></Rise>)}
          {a.hashes && (
            <Rise>
              <dl className="hashes">
                <div><dt className="mono">sha256 of the attacker's request</dt><dd className="mono ne-t">{a.hashes.attacker}</dd></div>
                <div><dt className="mono">sha256 of the owner's request, rebuilt by the contract</dt><dd className="mono eq-t">{a.hashes.owner}</dd></div>
              </dl>
            </Rise>
          )}
        </div>
        {a.hashes && <div className="detail-r"><Token state="break" /></div>}
      </section>
      <section className="sec">
        <span className="eyebrow mono">Transactions</span>
        <ul className="txs">
          {a.txs.map((t, k) => (
            <Rise key={k}>
              <li className={t.ok ? "ok" : "fail"}>
                <span className="mono tn">{String(k + 1).padStart(2, "0")}</span>
                <span className="tl">{t.label}</span>
                <span className="tr mono">{t.result}</span>
                <span className="tid">{t.id ? <Tx id={t.id} /> : <em className="dim small">rejected before inclusion</em>}</span>
              </li>
            </Rise>
          ))}
        </ul>
      </section>
      <TLink to={`/attacks/${next.slug}`} className="nextcard">
        <small className="mono">Next attack · {next.n}</small>
        <span>{next.name} <i>→</i></span>
      </TLink>
    </main>
  );
}
