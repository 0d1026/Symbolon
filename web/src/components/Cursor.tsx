import { useEffect, useRef } from "react";
import { gsap, finePointer, reduced } from "../lib/motion";

export function Cursor() {
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!finePointer() || reduced() || !ring.current) return;
    const el = ring.current;
    document.documentElement.classList.add("has-cursor");
    const x = gsap.quickTo(el, "x", { duration: 0.45, ease: "power3" });
    const y = gsap.quickTo(el, "y", { duration: 0.45, ease: "power3" });
    const move = (e: PointerEvent) => {
      x(e.clientX);
      y(e.clientY);
      el.classList.add("on");
      const t = e.target as HTMLElement;
      el.classList.toggle("hot", !!t.closest("a,button,[data-cursor]"));
    };
    const leave = () => el.classList.remove("on");
    window.addEventListener("pointermove", move);
    document.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      document.documentElement.classList.remove("has-cursor");
    };
  }, []);
  return <div ref={ring} className="cursor" aria-hidden="true"><i /></div>;
}
