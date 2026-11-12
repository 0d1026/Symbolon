import { ATTACKS } from "../data/attacks";

declare const __SITE_URL__: string;
export const SITE_URL: string = __SITE_URL__;
export const SITE_NAME = "Symbolon";
export const OG_IMAGE = `${SITE_URL}/og.jpg`;

export type Meta = { title: string; description: string; noindex?: boolean };

const HOME: Meta = {
  title: "Symbolon: two halves must fit before an agent pays",
  description:
    "A NEAR wallet for AI agents. It pays only when the owner's rules pass and an attested AI model approved this exact invoice. See six live attacks fail.",
};

const PAGES: Record<string, Meta> = {
  "/": HOME,
  "/attacks": {
    title: "Six live attacks | Symbolon",
    description:
      "Six live attacks on the Symbolon testnet wallet: forged approval, tampered response, replay, stolen key, prompt injection and a large payment. Every transaction is linked.",
  },
  "/wallet": {
    title: "Wallet | Symbolon",
    description:
      "A live, read-only view of the Symbolon wallet on NEAR testnet: spending caps, the attested model key, the agent key's limits and the USDC balance.",
  },
  "/demo": {
    title: "Break it yourself: live lab | Symbolon",
    description:
      "Change one character of a real signed NEAR AI decision and watch the Symbolon wallet's checks catch it, in your browser. Or replay an HTTP 402 purchase.",
  },
  "/verify": {
    title: "Verify it yourself | Symbolon",
    description:
      "Check Symbolon without trusting us. Build and test the contract, then run three live testnet checks in your browser. No keys or accounts needed.",
  },
  "/deployments": {
    title: "Deployments | Symbolon",
    description:
      "Symbolon accounts and transactions on NEAR testnet, from the locked TDX verifier to the live payments and attacks.",
  },
};

export function metaFor(pathname: string): Meta {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (PAGES[path]) return PAGES[path];
  const m = path.match(/^\/attacks\/([^/]+)$/);
  const a = m && ATTACKS.find((x) => x.slug === m[1]);
  if (a) {
    return {
      title: `${a.name} attack | Symbolon`,
      description: `${a.name} attack on the Symbolon testnet wallet. ${a.stopped} Every transaction is linked.`,
    };
  }
  return { title: "Page not found | Symbolon", description: HOME.description, noindex: true };
}

function setMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}

/** Keeps title, description, canonical and social tags in step with the route. */
export function applyMeta(pathname: string) {
  const m = metaFor(pathname);
  const url = `${SITE_URL}${pathname === "/" ? "/" : pathname.replace(/\/$/, "")}`;
  document.title = m.title;
  setMeta("name", "description", m.description);
  setMeta("name", "robots", m.noindex ? "noindex, follow" : "index, follow, max-image-preview:large");
  setMeta("property", "og:title", m.title);
  setMeta("property", "og:description", m.description);
  setMeta("property", "og:url", url);
  setMeta("property", "og:image", OG_IMAGE);
  setMeta("name", "twitter:image", OG_IMAGE);
  setMeta("name", "twitter:title", m.title);
  setMeta("name", "twitter:description", m.description);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = url;
}
