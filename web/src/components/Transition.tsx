import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { gsap, ScrollTrigger, reduced, scrollTop, setReady } from "../lib/motion";

type Ctx = { go: (to: string) => void };
const TransitionCtx = createContext<Ctx>({ go: () => {} });
export const useTransition = () => useContext(TransitionCtx);

const SEEN = "symbolon-seen";

export function TransitionProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const loc = useLocation();
  const busy = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const [firstVisit] = useState(() => !sessionStorage.getItem(SEEN) && !reduced());
  const [label, setLabel] = useState("");

  // Preloader: counter, then the two halves part to reveal the page.
  useLayoutEffect(() => {
    if (!firstVisit) {
      gsap.set(".cur-l", { xPercent: -101 });
      gsap.set(".cur-r", { xPercent: 101 });
      sessionStorage.setItem(SEEN, "1");
      setReady();
      return;
    }
    const ctx = gsap.context(() => {
      const n = { v: 0 };
      const tl = gsap.timeline({ onComplete: () => { sessionStorage.setItem(SEEN, "1"); } });
      tl.fromTo(".pre-word span", { yPercent: 110 }, { yPercent: 0, duration: 1, ease: "expo.out", stagger: 0.04 })
        .to(n, { v: 100, duration: 1.4, ease: "power2.inOut", onUpdate: () => { if (counter.current) counter.current.textContent = String(Math.round(n.v)).padStart(3, "0"); } }, 0.1)
        .to(".pre-ui", { opacity: 0, duration: 0.3 }, ">0.1")
        .add(() => setReady(), ">-0.05")
        .to(".cur-l", { xPercent: -101, duration: 1.1, ease: "expo.inOut" }, "<")
        .to(".cur-r", { xPercent: 101, duration: 1.1, ease: "expo.inOut" }, "<")
        .set(".pre-ui", { display: "none" });
    }, root);
    return () => ctx.revert();
  }, [firstVisit]);

  const go = (to: string) => {
    if (busy.current || to === loc.pathname) return;
    if (reduced()) { nav(to); scrollTop(); return; }
    busy.current = true;
    setLabel(to === "/" ? "Symbolon" : to.replace("/", "").split("/")[0]);
    const tl = gsap.timeline();
    tl.set(".cur-ui", { display: "flex", opacity: 0 })
      .to([".cur-l", ".cur-r"], { xPercent: 0, duration: 0.7, ease: "expo.inOut" })
      .to(".cur-ui", { opacity: 1, duration: 0.25 }, "<0.35")
      .add(() => {
        nav(to);
        scrollTop();
      })
      .add(() => { ScrollTrigger.refresh(); }, "+=0.25")
      .to(".cur-ui", { opacity: 0, duration: 0.2 })
      .to(".cur-l", { xPercent: -101, duration: 0.85, ease: "expo.inOut" }, "<0.05")
      .to(".cur-r", { xPercent: 101, duration: 0.85, ease: "expo.inOut" }, "<")
      .set(".cur-ui", { display: "none" })
      .add(() => { busy.current = false; });
  };

  return (
    <TransitionCtx.Provider value={{ go }}>
      {children}
      <div ref={root} className="curtain" aria-hidden="true">
        <div className="cur-half cur-l" />
        <div className="cur-half cur-r" />
        {firstVisit && (
          <div className="pre-ui">
            <div className="pre-word">
              {"Symbolon".split("").map((c, i) => (
                <span key={i}>{c}</span>
              ))}
            </div>
            <div className="pre-count mono"><span ref={counter}>000</span><i>%</i></div>
          </div>
        )}
        <div className="cur-ui" style={{ display: "none" }}>
          <span className="mono">{label}</span>
        </div>
      </div>
    </TransitionCtx.Provider>
  );
}
