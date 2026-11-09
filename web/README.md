# Symbolon web

Frontend for Symbolon. Vite + React + TypeScript, GSAP (ScrollTrigger) and Lenis for motion. No backend: pages read the public testnet RPC from the browser.

```
cd web
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check, then bundle to dist/
```

## Pages

| Route | What it shows |
| --- | --- |
| `/` | Hero, the four conditions, "try to fool it" hash match, the pinned four-step flow, attacks, live check |
| `/attacks`, `/attacks/:slug` | The six testnet attacks with transactions, balances and stated limits |
| `/wallet` | Live read-only views of `v2.symbolon.testnet`; falls back to the 2026-11-07 repo snapshot if RPC is unreachable |
| `/demo` | Live lab: edit a real signed NEAR AI decision and watch the checks catch it, in the browser. Second tab: the recorded HTTP 402 purchase |
| `/verify` | Build and test commands, plus three checks that run in the browser |
| `/deployments` | Accounts, live events and setup transactions |

Not built yet: `/owner/*` (needs wallet connect), `/docs`, `/about`.

## Where things live

- `src/data/attacks.ts`, `src/data/chain.ts`: content copied from `docs/` and the README. Update these when the docs change.
- `src/lib/near.ts`: RPC helper. `rpc.testnet.near.org` is deprecated and returns 429 without CORS headers, so `test.rpc.fastnear.com` is tried first.
- `src/components/Token.tsx`: the broken-token SVG used as the main visual (states `match`, `break`, `idle`).
- `src/styles/app.css`: all styling and design tokens.

Motion respects `prefers-reduced-motion`: smooth scroll, the preloader, the page curtain and reveals are skipped.

## SEO and social sharing

- Static tags (title, description, canonical, Open Graph, Twitter card, JSON-LD) live in `index.html`. `src/lib/seo.ts` updates them on every route change, with a per-page title and description.
- Social image: `public/og.jpg` (1200x630). `public/apple-touch-icon.png` is 180x180. Both are rendered from `tools/og.html` (open it in the dev server at `/tools/og.html`, capture, crop).
- `sitemap.xml` and `robots.txt` are generated at build time by `vite.config.ts`.
- Absolute URLs need the real domain. The default is the placeholder `https://symbolon.example`. Build with the real one:

```
SITE_URL=https://your-domain.com npm run build
```

- The site is a single-page app, so the host must fall back to `index.html` for unknown paths (for example `/attacks/replay`).

## The live lab (`/demo`)

`src/components/Lab.tsx` runs the contract's payment checks in the browser, in the contract's order: merchant ed25519 signature, request rebuilt from the owner's template (`prefix + nonce + middle + invoice + suffix`), sha256 of request and response, EIP-191 signer recovery over `model:request_hash:response_hash`, then the decision checks. Whether the recovered signer is an attested key (`is_key_valid`) and the spending caps (`get_caps`) are read live from testnet.

- Data: `src/data/signed.ts`, generated from `contract/tests/fixtures/decisions_2026-11-07.json` (real NEAR AI signatures).
- Crypto: `src/lib/verify.ts` (`@noble/hashes`, `@noble/curves`).
- It sends no transaction. Nonce single-use, the merchant allowlist and settled invoices are on-chain state and are not simulated.
