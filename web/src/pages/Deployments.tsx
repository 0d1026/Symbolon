import { ACCOUNTS, EVENTS, SETUP, VERIFIER_HASH } from "../data/chain";
import { Reveal, Rise } from "../components/Reveal";
import { Tx } from "../components/Bits";

export default function Deployments() {
  return (
    <main className="page">
      <header className="phead">
        <span className="eyebrow mono">NEAR testnet · 2026-11-07</span>
        <Reveal as="h1" text="Where it *lives.*" wait />
        <p className="lede">Testnet only. Every link opens NearBlocks.</p>
      </header>

      <section className="sec">
        <span className="eyebrow mono">Accounts</span>
        <ul className="tbl">
          {ACCOUNTS.map((a) => (
            <Rise key={a.id}><li><a className="mono" href={`https://testnet.nearblocks.io/address/${a.id}`} target="_blank" rel="noreferrer">{a.id} ↗</a><span>{a.role}</span></li></Rise>
          ))}
        </ul>
        <p className="note">Verifier code hash <code>{VERIFIER_HASH}</code>, same as mainnet. The wallet still holds its testnet deployment key.</p>
      </section>

      <section className="sec">
        <span className="eyebrow mono">Live events</span>
        <ul className="tbl">
          {EVENTS.map((e) => <Rise key={e.id}><li><span>{e.label}</span><Tx id={e.id} /></li></Rise>)}
        </ul>
      </section>

      <section className="sec">
        <details className="fold">
          <summary className="mono">Setup of v2 ({SETUP.length} transactions)</summary>
          <ul className="tbl">
            {SETUP.map((e) => <li key={e.id}><span>{e.label}</span><Tx id={e.id} /></li>)}
          </ul>
        </details>
      </section>
    </main>
  );
}
