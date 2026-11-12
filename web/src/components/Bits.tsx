import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { gsap, reduced } from "../lib/motion";
import { txUrl } from "../data/attacks";
import { MODEL_KEY, PROFILE, WALLET } from "../data/chain";
import { view, viewAccount } from "../lib/near";

export function CountUp({ to, decimals = 0, suffix = "", className = "" }: { to: number; decimals?: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    if (reduced()) { el.textContent = fmt(to); return; }
    const o = { v: 0 };
    const ctx = gsap.context(() => {
      gsap.to(o, { v: to, duration: 1.6, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 92%", once: true }, onUpdate: () => { el.textContent = fmt(o.v); } });
    }, el);
    el.textContent = fmt(0);
    return () => ctx.revert();
  }, [to, decimals, suffix]);
  return <span ref={ref} className={className}>{to}</span>;
}

const GLYPHS = "0123456789abcdef";
/** Types a string by scrambling hex glyphs until each character settles. */
export function Scramble({ text, className = "" }: { text: string; className?: string }) {
  const [out, setOut] = useState(text);
  useEffect(() => {
    if (reduced()) { setOut(text); return; }
    let frame = 0;
    const total = 22;
    const id = setInterval(() => {
      frame++;
      setOut(text.split("").map((c, i) => (frame > total * (i / text.length) + 6 ? c : GLYPHS[Math.floor(Math.random() * 16)])).join(""));
      if (frame > total + 8) { clearInterval(id); setOut(text); }
    }, 28);
    return () => clearInterval(id);
  }, [text]);
  return <span className={className}>{out}</span>;
}

export function Tx({ id, short = true }: { id: string; short?: boolean }) {
  return (
    <a className="tx mono" href={txUrl(id)} target="_blank" rel="noreferrer" title={id}>
      {short ? `${id.slice(0, 6)}…${id.slice(-5)}` : id} ↗
    </a>
  );
}

export function CopyBlock({ code, lang = "sh", label }: { code: string; lang?: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="code">
      <div className="code-bar mono">
        <span>{label ?? lang}</span>
        <button onClick={copy} aria-label="Copy command">{done ? "Copied" : "Copy"}</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export function SectionHead({ index, title, children }: { index: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="shead">
      <span className="eyebrow mono">§ {index}</span>
      <h2>{title}</h2>
      {children && <p className="lede">{children}</p>}
    </div>
  );
}

export function Marquee({ items }: { items: string[] }) {
  const row = (
    <div className="mq-row" aria-hidden="false">
      {items.map((t, i) => (
        <span key={i}>{t}<b>✦</b></span>
      ))}
    </div>
  );
  return (
    <div className="marquee mono" role="presentation">
      <div className="mq-track">{row}{row}</div>
    </div>
  );
}

/** HUD readout for the hero: real testnet block height and key status, plus a UTC clock. */
export function Telemetry() {
  const [now, setNow] = useState(() => new Date());
  const [head, setHead] = useState<number | null>(null);
  const [key, setKey] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let live = true;
    const pull = () => {
      viewAccount(WALLET).then((a) => live && (setHead(a.block_height), setFailed(false))).catch(() => live && setFailed(true));
    };
    pull();
    view<boolean>(WALLET, "is_key_valid", { address: MODEL_KEY, profile: PROFILE }).then((v) => live && setKey(v)).catch(() => {});
    const id = setInterval(pull, 15000);
    return () => { live = false; clearInterval(id); };
  }, []);
  const t = now.toISOString().slice(11, 19);
  return (
    <div className="telemetry mono hero-fade" aria-label="Live testnet readout">
      <p>//</p>
      <p>UTC {t}</p>
      <p>{failed ? "CHAIN: RPC UNREACHABLE" : head ? `BLOCK ${head.toLocaleString("en-US")}` : "BLOCK …"}</p>
      <p>MODEL KEY: {key === null ? "…" : key ? "ATTESTED" : "NOT VALID"}</p>
      <p>AGENT KEY: 2 METHODS</p>
      <p>{"};"}</p>
    </div>
  );
}
