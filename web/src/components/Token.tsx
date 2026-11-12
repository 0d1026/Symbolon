import { useId, useLayoutEffect, useRef } from "react";
import { gsap, onReady, reduced } from "../lib/motion";

export type TokenState = "match" | "break" | "idle";

const SEAM: [number, number][] = [
  [220, 0], [205, 48], [236, 92], [208, 138], [238, 176], [212, 220],
  [234, 262], [206, 306], [238, 350], [212, 396], [222, 440],
];
const PTS = SEAM.map((p) => p.join(",")).join(" ");
const CLIP_L = `0,0 ${PTS} 0,440`;
const CLIP_R = `${PTS} 440,440 440,0`;
const BODY =
  "M220 18 C334 14 418 100 422 214 C426 332 336 426 220 422 C104 426 16 336 18 222 C14 106 104 22 220 18 Z";
const GRAIN = ["M70 120 L370 120", "M52 176 L388 176", "M44 232 L396 232", "M52 288 L388 288", "M70 344 L370 344"];

const COLORS: Record<TokenState, { stroke: string; opacity: number }> = {
  match: { stroke: "#7ad3b0", opacity: 1 },
  break: { stroke: "#ff5a36", opacity: 1 },
  idle: { stroke: "#ece4d2", opacity: 0.25 },
};

export function Token({
  state = "match",
  intro = false,
  className = "",
  label,
}: {
  state?: TokenState;
  intro?: boolean;
  className?: string;
  label?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const root = useRef<SVGSVGElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      const l = ".tk-l";
      const r = ".tk-r";
      const edge = ".tk-edge";
      const to: Record<TokenState, [gsap.TweenVars, gsap.TweenVars]> = {
        match: [{ x: 0, y: 0, rotate: 0 }, { x: 0, y: 0, rotate: 0 }],
        break: [{ x: -14, y: -6, rotate: -2 }, { x: 54, y: 36, rotate: 6 }],
        idle: [{ x: -20, y: 0, rotate: 0 }, { x: 20, y: 0, rotate: 0 }],
      };
      const [tl, tr] = to[state];
      const c = COLORS[state];
      const common = { svgOrigin: "220 220" };

      if (first.current && intro && !reduced()) {
        first.current = false;
        gsap.set(l, { x: -220, rotate: -18, opacity: 0, ...common });
        gsap.set(r, { x: 220, rotate: 18, opacity: 0, ...common });
        gsap.set(edge, { stroke: "#ece4d2", opacity: 0.2 });
        const off = onReady(() => {
          const t = gsap.timeline({ delay: 0.15 });
          t.to([l, r], { x: 0, rotate: 0, opacity: 1, duration: 1.9, ease: "expo.out" })
            .to(edge, { stroke: c.stroke, opacity: 1, duration: 0.2 }, "-=0.35")
            .fromTo(edge, { strokeWidth: 9 }, { strokeWidth: 2, duration: 1.1, ease: "power3.out" }, "<");
        });
        return () => off();
      }
      first.current = false;
      gsap.to(l, { ...tl, ...common, duration: reduced() ? 0 : 1.1, ease: "expo.out", overwrite: "auto" });
      gsap.to(r, { ...tr, ...common, duration: reduced() ? 0 : 1.1, ease: "expo.out", overwrite: "auto" });
      gsap.to(edge, { stroke: c.stroke, opacity: c.opacity, duration: 0.5, overwrite: "auto" });
    }, el);
    return () => ctx.revert();
  }, [state, intro]);

  const half = (side: "l" | "r") => (
    <g className={`tk-${side}`}>
      <g clipPath={`url(#${uid}-${side})`}>
        <path d={BODY} fill={`url(#${uid}-g)`} />
        <path d={BODY} fill="#000" filter={`url(#${uid}-n)`} opacity=".42" style={{ mixBlendMode: "multiply" }} />
        {GRAIN.map((d, i) => (
          <path key={i} d={d} stroke="#0d0c0a" strokeOpacity=".5" strokeWidth="1.4" strokeLinecap="round" />
        ))}
        <text x="220" y="246" textAnchor="middle" fontFamily="'Instrument Serif', serif" fontSize="74" fill="#0d0c0a" fillOpacity=".86">
          Symbolon
        </text>
        <text x="220" y="84" textAnchor="middle" fontFamily="'Geist Mono', monospace" fontSize="13" letterSpacing="5" fill="#0d0c0a" fillOpacity=".6">
          σύμβολον
        </text>
        <text x="220" y="384" textAnchor="middle" fontFamily="'Geist Mono', monospace" fontSize="12" letterSpacing="2" fill="#0d0c0a" fillOpacity=".55">
          sha256 ≡ sha256
        </text>
      </g>
      <g clipPath={`url(#${uid}-b)`}>
        <polyline className="tk-edge" points={PTS} fill="none" stroke="#ece4d2" strokeWidth="2" strokeLinejoin="round" />
      </g>
    </g>
  );

  return (
    <svg ref={root} className={`token ${className}`} viewBox="-90 -30 620 500" role="img" aria-label={label ?? "A token broken in two halves"}>
      <defs>
        <clipPath id={`${uid}-l`}><polygon points={CLIP_L} /></clipPath>
        <clipPath id={`${uid}-r`}><polygon points={CLIP_R} /></clipPath>
        <clipPath id={`${uid}-b`}><path d={BODY} /></clipPath>
        <radialGradient id={`${uid}-g`} cx="35%" cy="28%" r="85%">
          <stop offset="0" stopColor="#f6f0e0" />
          <stop offset=".55" stopColor="#d9cfb7" />
          <stop offset="1" stopColor="#a99f86" />
        </radialGradient>
        <filter id={`${uid}-n`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" result="t" />
          <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.3 -.35" result="m" />
          <feComposite in="m" in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
      {half("l")}
      {half("r")}
    </svg>
  );
}
