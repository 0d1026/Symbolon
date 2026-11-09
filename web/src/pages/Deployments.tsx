import { ACCOUNTS, EVENTS, SETUP, VERIFIER_HASH } from "../data/chain";
import { Reveal, Rise } from "../components/Reveal";
import { Tx } from "../components/Bits";

export default function Deployments() {
  return (
    <main className="page">
      <header className="phead">
        <span className="eyebrow mono">NEAR testnet · 2026-11-07</span>
        <Reveal as="h1" text="Where it *lives.*" wait />
        <p className="lede">Every account and transaction below can be opened on NearBlocks. Mainnet is not deployed.</p>
      </header>

      <section className="sec">
        <span className="eyebrow mono">Accounts</span>
        <ul className="tbl">
          {ACCOUNTS.map((a) => (
            <Rise key={a.id}><li><a className="mono" href={`https://testnet.nearblocks.io/address/${a.id}`} target="_blank" rel="noreferrer">{a.id} ↗</a><span>{a.role}</span></li></Rise>
          ))}
        </ul>
        <p className="note">Verifier code hash <code>{VERIFIER_HASH}</code>, identical to <code>tee-verifier-2026-08-04.near</code> on mainnet. Caps: approval threshold 10 USDC, 60 per payment, 100 per day.</p>
        <p className="note">Testnet note: the wallet still has its deployment full-access key, used for the in-place upgrade. A production wallet deletes it after deployment.</p>
      </section>

      <section className="sec">
        <span className="eyebrow mono">Live events</span>
        <ul className="tbl">
          {EVENTS.map((e) => <Rise key={e.id}><li><span>{e.label}</span><Tx id={e.id} /></li></Rise>)}
        </ul>
      </section>

      <section className="sec">
        <span className="eyebrow mono">Setup of v2</span>
        <ul className="tbl">
          {SETUP.map((e) => <Rise key={e.id}><li><span>{e.label}</span><Tx id={e.id} /></li></Rise>)}
        </ul>
      </section>
    </main>
  );
}
