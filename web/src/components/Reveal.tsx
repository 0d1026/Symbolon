import { createElement, useLayoutEffect, useRef, type ReactNode } from "react";
import { gsap, onReady, reduced } from "../lib/motion";

/** Text with word masks. `*italic*` toggles italic serif, `|` forces a line break. */
export function Reveal({
  text,
  as = "div",
  className = "",
  delay = 0,
  wait = false,
  start = "top 88%",
}: {
  text: string;
  as?: string;
  className?: string;
  delay?: number;
  wait?: boolean;
  start?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const inner = el.querySelectorAll(".wi");
    if (reduced()) { gsap.set(inner, { yPercent: 0 }); return; }
    let off = () => {};
    const ctx = gsap.context(() => {
      gsap.set(inner, { yPercent: 118, rotate: 4 });
      const vars: gsap.TweenVars = { yPercent: 0, rotate: 0, duration: 1.15, ease: "expo.out", stagger: 0.055, delay };
      if (wait) {
        off = onReady(() => { gsap.to(inner, vars); });
      } else {
        gsap.to(inner, { ...vars, scrollTrigger: { trigger: el, start, once: true } });
      }
    }, el);
    return () => { off(); ctx.revert(); };
  }, [text, wait, delay, start]);

  const nodes: ReactNode[] = [];
  text.split("*").forEach((seg, si) => {
    seg.split(" ").forEach((word, wi) => {
      if (!word) return;
      word.split("|").forEach((part, pi) => {
        if (pi > 0) nodes.push(<br key={`b${si}-${wi}-${pi}`} />);
        if (!part) return;
        nodes.push(
          <span className="w" key={`${si}-${wi}-${pi}`}>
            <span className={`wi${si % 2 ? " it" : ""}`}>{part}</span>
          </span>,
        );
        nodes.push(" ");
      });
    });
  });
  return createElement(as, { ref, className: `reveal ${className}` }, nodes);
}

/** Fade + rise on enter. */
export function Rise({ children, className = "", delay = 0, y = 28 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(el, { y, opacity: 0 }, { y: 0, opacity: 1, duration: 1.1, delay, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    }, el);
    return () => ctx.revert();
  }, [y, delay]);
  return <div ref={ref} className={className}>{children}</div>;
}

/** Words fade in as you scroll through the block. */
export function ScrubText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const words = el.querySelectorAll(".sw");
    if (reduced()) { gsap.set(words, { opacity: 1 }); return; }
    const ctx = gsap.context(() => {
      gsap.fromTo(words, { opacity: 0.14 }, { opacity: 1, stagger: 0.1, ease: "none", scrollTrigger: { trigger: el, start: "top 78%", end: "bottom 45%", scrub: 0.6 } });
    }, el);
    return () => ctx.revert();
  }, [text]);
  return (
    <p ref={ref} className={`scrub ${className}`}>
      {text.split(" ").map((w, i) => (
        <span className="sw" key={i}>{w} </span>
      ))}
    </p>
  );
}
