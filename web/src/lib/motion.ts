import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

export const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const finePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

let lenis: Lenis | null = null;
export const getLenis = () => lenis;

export function startSmoothScroll() {
  if (reduced() || lenis) return;
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis?.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

export function scrollTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo(0, 0);
}

// "ready" gate: hero animations wait until the preloader has opened.
let ready = false;
const fns = new Set<() => void>();
export const setReady = () => {
  ready = true;
  fns.forEach((f) => f());
  fns.clear();
};
export function onReady(f: () => void) {
  if (ready) {
    f();
    return () => {};
  }
  fns.add(f);
  return () => fns.delete(f);
}

export { gsap, ScrollTrigger };
