import { useLayoutEffect, useRef, useState } from "react";
import { gsap, ScrollTrigger, onReady, reduced } from "../lib/motion";
import { Reveal, Rise, ScrubText } from "../components/Reveal";
import { Token, type TokenState } from "../components/Token";
import { TLink } from "../components/TLink";
import { Marquee, Scramble, SectionHead, Telemetry, Tx } from "../components/Bits";
import { LiveCheck } from "../components/LiveCheck";
import { ATTACKS } from "../data/attacks";
import { MODEL_KEY, PROFILE, WALLET } from "../data/chain";
import { view } from "../lib/near";

/* ───────────────────────── Hero ───────────────────────── */
function Hero() {
  const root = useRef<HTMLElement>(null);
  const tilt = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let off = () => {};
    const ctx = gsap.context(() => {
      if (reduced()) return;
      const fades = el.querySelectorAll(".hero-fade");
      gsap.set(fades, { opacity: 0, y: 22 });
      off = onReady(() => {
        gsap.to(fades, { opacity: 1, y: 0, duration: 1.2, ease: "expo.out", stagger: 0.12, delay: 0.7 });
      });
      gsap.to(".hero-token", {
        yPercent: -14, rotate: 5, scale: 0.9, ease: "none",
        scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: true },
      });
      gsap.to(".hero-h1", {
        yPercent: -18, opacity: 0.25, ease: "none",
        scrollTrigger: { trigger: el, start: "top top", end: "bottom 30%", scrub: true },
      });
    }, el);

    // pointer tilt on the token
    const t = tilt.current;
    let move: ((e: PointerEvent) => void) | null = null;
    if (t && !reduced() && window.matchMedia("(hover: hover)").matches) {
      const rx = gsap.quickTo(t, "rotationX", { duration: 0.8, ease: "power3" });
      const ry = gsap.quickTo(t, "rotationY", { duration: 0.8, ease: "power3" });
      move = (e: PointerEvent) => {
        rx(((e.clientY / window.innerHeight) - 0.5) * -10);
        ry(((e.clientX / window.innerWidth) - 0.5) * 14);
      };
      window.addEventListener("pointermove", move);
    }
    return () => {
      off();
      if (move) window.removeEventListener("pointermove", move);
      ctx.revert();
    };
  }, []);

  return (
    <section className="hero" ref={root}>
      <div className="hero-meta mono hero-fade">
        <span>NEAR testnet</span>
        <span>{WALLET}</span>
        <span>AI Security &amp; Defense</span>
      </div>
      <Telemetry />
      <Reveal as="h1" className="hero-h1" text="Two halves|must *fit*|before an|agent pays." wait />
      <div className="hero-token" ref={tilt}>
        <Token intro state="match" className="float" />
      </div>
      <p className="hero-sub hero-fade">
        A NEAR wallet for AI agents. It pays only when an attested AI model approved <em>this exact</em> invoice.
      </p>
      <div className="hero-cta hero-fade">
        <TLink to="/attacks" className="btn"><span>See six attacks fail</span><i>→</i></TLink>
        <TLink to="/verify" className="btn btn-ghost"><span>Verify it yourself</span></TLink>
      </div>
      <div className="hero-scroll mono hero-fade"><i /> Scroll</div>
    </section>
  );
}

/* ───────────────────────── Definition ───────────────────────── */
function Definition() {
  return (
    <section className="sec define">
      <div className="define-l">
        <Rise>
          <div className="dict">
            <div className="dict-word">σύμβολον</div>
            <div className="mono dict-pron">sým·bo·lon · Greek</div>
            <p>A token broken in two. Only the true pair fits.</p>
          </div>
        </Rise>
      </div>
      <div className="define-r">
        <span className="eyebrow mono">§ 01 · The problem</span>
        <ScrubText
          className="define-text"
          text="Anyone can get a genuine NEAR AI approval by sending their own prompt. So a signature alone proves nothing. Symbolon rebuilds the exact request itself and accepts only a signature that fits."
        />
      </div>
    </section>
  );
}

/* ───────────────────────── Four conditions ───────────────────────── */
const CONDITIONS = [
  { n: "01", t: "A trusted merchant", d: "The merchant signed the invoice and is on the allowlist." },
  { n: "02", t: "This exact invoice", d: "The model approved this request, not any other." },
  { n: "03", t: "Real hardware", d: "The model's key was verified on chain against Intel TDX." },
  { n: "04", t: "Within the limits", d: "Caps hold. Large payments wait for the owner." },
];

function Conditions() {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || reduced()) return;
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>(".cond");
      cards.forEach((c, i) => {
        if (i === cards.length - 1) return;
        gsap.to(c, {
          scale: 0.92, opacity: 0.45, ease: "none",
          scrollTrigger: { trigger: cards[i + 1], start: "top 85%", end: "top 25%", scrub: true },
        });
      });
    }, el);
    return () => ctx.revert();
  }, []);
  return (
    <section className="sec conds" ref={root}>
      <SectionHead index="02 · The rule" title={<>Four things must hold <em>at once.</em></>} />
      <div className="cond-stack">
        {CONDITIONS.map((c, i) => (
          <article className="cond" key={c.n} style={{ top: `calc(11vh + ${i * 22}px)` }}>
            <div className="cond-n">{c.n}</div>
            <div className="cond-b">
              <h3>{c.t}</h3>
              <p>{c.d}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── Try to fool it ───────────────────────── */
const OWNER_HASH = ATTACKS[0].hashes!.owner;
const ATTACKER_HASH = ATTACKS[0].hashes!.attacker;

function HashLine({ signed, rebuilt }: { signed: string; rebuilt: string }) {
  return (
    <span className="hash">
      {signed.split("").map((c, i) => (
        <i key={i} className={c === rebuilt[i] ? "eq" : "ne"}>{c}</i>
      ))}
    </span>
  );
}

function Match() {
  const [who, setWho] = useState<"owner" | "attacker">("owner");
  const signed = who === "owner" ? OWNER_HASH : ATTACKER_HASH;
  const ok = signed === OWNER_HASH;
  const state: TokenState = ok ? "match" : "break";
  return (
    <section className="sec match">
      <div className="match-l">
        <SectionHead index="03 · The match" title={<>Try to <em>fool</em> it.</>}>
          Pick whose request the model signed. Real hashes from a testnet attack.
        </SectionHead>
        <div className="seg" role="tablist" aria-label="Whose request was signed">
          <button role="tab" aria-selected={ok} className={ok ? "on" : ""} onClick={() => setWho("owner")}>The owner's request</button>
          <button role="tab" aria-selected={!ok} className={!ok ? "on" : ""} onClick={() => setWho("attacker")}>The attacker's request</button>
        </div>
        <dl className="hashes">
          <div>
            <dt className="mono">Signed by the model</dt>
            <dd className="mono"><Scramble text={signed} className="hash-s" key={who} /></dd>
          </div>
          <div>
            <dt className="mono">Rebuilt by the wallet</dt>
            <dd className="mono"><HashLine signed={OWNER_HASH} rebuilt={signed} /></dd>
          </div>
        </dl>
        <div className={`verdict ${ok ? "good" : "bad"}`} aria-live="polite">
          <b className="mono">{ok ? "ACCEPTED" : "REFUSED"}</b>
          <span>{ok ? "The halves fit." : "The hashes differ."}</span>
          {!ok && <Tx id="4K3FyWkTVmePfbVo7NLgAN7HCDCYXr6xTk9LchThjYNB" />}
        </div>
      </div>
      <div className="match-r">
        <Token state={state} />
      </div>
    </section>
  );
}

/* ───────────────────────── Flow (pinned) ───────────────────────── */
const NODES: Record<string, { x: number; y: number; t: string; s: string }> = {
  merchant: { x: 70, y: 70, t: "Merchant", s: "signs invoices" },
  agent: { x: 70, y: 300, t: "AI agent", s: "function-call key" },
  model: { x: 540, y: 70, t: "NEAR AI", s: "model in a TEE" },
  wallet: { x: 305, y: 300, t: "Wallet", s: "Symbolon v2" },
  verifier: { x: 540, y: 300, t: "TDX verifier", s: "NEAR One · Intel" },
  usdc: { x: 305, y: 470, t: "USDC", s: "NEP-141" },
};
type Edge = [string, string];
const STEPS: { t: string; d: string; edges: Edge[] }[] = [
  { t: "Register the model key", d: "The wallet verifies the model's Intel quote on chain.", edges: [["model", "wallet"], ["wallet", "verifier"]] },
  { t: "Get an invoice", d: "The merchant answers HTTP 402 with a signed invoice.", edges: [["merchant", "agent"]] },
  { t: "Ask the model", d: "The agent sends the invoice to NEAR AI and gets a signed decision.", edges: [["agent", "wallet"], ["agent", "model"], ["model", "agent"]] },
  { t: "Pay", d: "The wallet checks everything, then sends USDC or holds it for the owner.", edges: [["agent", "wallet"], ["wallet", "usdc"], ["usdc", "merchant"]] },
];

function Flow() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(min-width: 900px) and (prefers-reduced-motion: no-preference)", () => {
      ScrollTrigger.create({
        trigger: el, start: "top top", end: "+=320%", pin: true, scrub: true,
        onUpdate: (self) => setActive(Math.min(STEPS.length - 1, Math.floor(self.progress * STEPS.length))),
      });
      gsap.to(".flow-bar i", { scaleY: 1, ease: "none", scrollTrigger: { trigger: el, start: "top top", end: "+=320%", scrub: true } });
    });
    return () => mm.revert();
  }, []);
  const on = STEPS[active].edges;
  const isOn = (a: string, b: string) => on.some(([x, y]) => x === a && y === b);
  const lit = new Set(on.flat());
  return (
    <section className="flow" ref={root}>
      <div className="flow-inner">
        <div className="flow-l">
          <SectionHead index="04 · The path" title={<>One payment, <em>four steps.</em></>} />
          <ol className="flow-steps">
            {STEPS.map((s, i) => (
              <li key={s.t} className={i === active ? "on" : ""}>
                <button onClick={() => setActive(i)} aria-current={i === active}>
                  <span className="mono">0{i + 1}</span>
                  <h3>{s.t}</h3>
                </button>
                <p>{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="flow-r">
          <svg viewBox="0 0 640 540" role="img" aria-label={`Diagram for step ${active + 1}: ${STEPS[active].t}`}>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="#7ad3b0" />
              </marker>
            </defs>
            {STEPS.flatMap((s) => s.edges).filter((e, i, a) => a.findIndex((z) => z[0] === e[0] && z[1] === e[1]) === i).map(([a, b]) => {
              const A = NODES[a], B = NODES[b];
              const live = isOn(a, b);
              const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
              const off = 56 / len;
              const x1 = A.x + dx * off, y1 = A.y + dy * off, x2 = B.x - dx * off, y2 = B.y - dy * off;
              // separate opposite arrows slightly
              const nx = -dy / len * 6, ny = dx / len * 6;
              return (
                <line key={a + b} x1={x1 + nx} y1={y1 + ny} x2={x2 + nx} y2={y2 + ny}
                  className={`edge${live ? " live" : ""}`} markerEnd={live ? "url(#arr)" : undefined} />
              );
            })}
            {Object.entries(NODES).map(([k, n]) => (
              <g key={k} transform={`translate(${n.x} ${n.y})`} className={`node${lit.has(k) ? " lit" : ""}`}>
                <circle r="48" />
                <text y="-2" textAnchor="middle" className="nt">{n.t}</text>
                <text y="14" textAnchor="middle" className="ns">{n.s}</text>
              </g>
            ))}
          </svg>
          <div className="flow-bar" aria-hidden="true"><i /></div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Attacks ───────────────────────── */
export function AttackRows({ full = false }: { full?: boolean }) {
  return (
    <ul className="arows">
      {ATTACKS.map((a) => (
        <li key={a.slug}>
          <TLink to={`/attacks/${a.slug}`} className="arow">
            <span className="mono an">{a.n}</span>
            <span className="aname">{a.name}</span>
            <span className="astop">{full ? a.did : a.stopped}</span>
            <span className="amoved mono"><small>attacker gets</small>0</span>
            <span className="aarrow" aria-hidden="true">↗</span>
          </TLink>
        </li>
      ))}
    </ul>
  );
}

function Attacks() {
  return (
    <section className="sec attacks">
      <SectionHead index="05 · The proof" title={<>Six live attacks. The attacker got <em>zero.</em></>} />
      <AttackRows />
      <Rise className="center"><TLink to="/attacks" className="btn btn-ghost"><span>All attacks and limits</span><i>→</i></TLink></Rise>
    </section>
  );
}

/* ───────────────────────── Verify ───────────────────────── */
function VerifyTeaser() {
  return (
    <section className="sec verify-t">
      <SectionHead index="06 · Don't trust us" title={<>Ask the chain <em>yourself.</em></>} />
      <Rise>
        <LiveCheck
          label="is_key_valid · is the model's key registered?"
          cmd={`view ${WALLET}.is_key_valid({\n  "address": "${MODEL_KEY}",\n  "profile": "${PROFILE}"\n})`}
          expect="true"
          run={async () => String(await view<boolean>(WALLET, "is_key_valid", { address: MODEL_KEY, profile: PROFILE }))}
        />
      </Rise>
      <Rise className="center"><TLink to="/verify" className="btn"><span>More ways to check</span><i>→</i></TLink></Rise>
    </section>
  );
}

const TICKER = ["6 live attacks", "attacker balance 0 USDC", "Intel TDX verified on chain", "NEAR AI signatures", "HTTP 402", "owner approves anything large"];

export default function Home() {
  return (
    <>
      <Hero />
      <Marquee items={TICKER} />
      <Definition />
      <Conditions />
      <Match />
      <Flow />
      <Attacks />
      <VerifyTeaser />
    </>
  );
}
