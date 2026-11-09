import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { gsap, reduced } from "../lib/motion";
import { TLink } from "./TLink";
import { REPO, WALLET } from "../data/chain";

const LINKS = [
  ["/attacks", "Attacks"],
  ["/wallet", "Wallet"],
  ["/demo", "Demo"],
  ["/verify", "Verify"],
  ["/deployments", "Deployments"],
] as const;

function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" className="mark">
      <path d="M16 3 L13.5 10 L18 15 L14.5 21 L17.5 29 L8 26 L3 16 L8 6 Z" fill="#ece4d2" />
      <path className="mark-r" d="M16 3 L13.5 10 L18 15 L14.5 21 L17.5 29 L24 26 L29 16 L24 6 Z" fill="#7ad3b0" />
    </svg>
  );
}

export function Nav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > 160 && y > last.current + 4);
      if (y < last.current - 4 || y < 160) setHidden(false);
      last.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (reduced()) return;
    const m = gsap.context(() => {
      gsap.fromTo(".nav", { yPercent: -100 }, { yPercent: 0, duration: 1.2, ease: "expo.out", delay: 2.2 });
    });
    return () => m.revert();
  }, []);

  return (
    <>
      <header className={`nav${hidden && !open ? " hide" : ""}${open ? " open" : ""}`}>
        <TLink to="/" className="brand" onClick={() => setOpen(false)}>
          <Mark />
          <span>Symbolon</span>
        </TLink>
        <nav className="nav-links" aria-label="Main">
          {LINKS.map(([to, label]) => (
            <TLink key={to} to={to} className={`nl${pathname.startsWith(to) ? " on" : ""}`}>{label}</TLink>
          ))}
        </nav>
        <div className="nav-end">
          <span className="net mono"><i className="dot" />testnet</span>
          <button className="burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span /><span />
          </button>
        </div>
      </header>
      <div className={`sheet${open ? " on" : ""}`} aria-hidden={!open}>
        {LINKS.map(([to, label], i) => (
          <TLink key={to} to={to} className="sheet-link"><small className="mono">0{i + 1}</small>{label}</TLink>
        ))}
      </div>
    </>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="foot-top">
        <p className="foot-claim">An AI agent can spend from this wallet only within the owner's limits, only when an AI model approved the payment, and only after the chain checked the model's key against genuine Intel hardware.</p>
        <div className="foot-cols mono">
          <div>
            <h4>Pages</h4>
            {LINKS.map(([to, label]) => <TLink key={to} to={to}>{label}</TLink>)}
          </div>
          <div>
            <h4>Elsewhere</h4>
            <a href={REPO} target="_blank" rel="noreferrer">GitHub ↗</a>
            <a href={`https://testnet.nearblocks.io/address/${WALLET}`} target="_blank" rel="noreferrer">Wallet on NearBlocks ↗</a>
            <a href="https://docs.near.ai/cloud/verification/chat.md" target="_blank" rel="noreferrer">NEAR AI verification ↗</a>
          </div>
        </div>
      </div>
      <div className="foot-word" aria-hidden="true">
        {"Symbolon".split("").map((c, i) => <span key={i}>{c}</span>)}
      </div>
      <div className="foot-base mono">
        <span>Built during NEAR HACKATHON · AI Security &amp; Defense, Agent Economy</span>
        <span>Testnet only · Apache 2.0</span>
      </div>
    </footer>
  );
}
