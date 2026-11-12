import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { ATTACKS } from "./src/data/attacks";

// The public origin of the deployed site. Set SITE_URL when building, for example
// SITE_URL=https://symbolon.example npm run build
// Social cards need an absolute image URL, so this must be the real domain before launch.
const SITE = (process.env.SITE_URL ?? "https://symbolon.example").replace(/\/$/, "");

const ROUTES = ["/", "/attacks", ...ATTACKS.map((a) => `/attacks/${a.slug}`), "/wallet", "/demo", "/verify", "/deployments"];

function seoFiles(): Plugin {
  return {
    name: "symbolon-seo",
    // "pre" so the placeholder is a full URL before Vite rewrites asset-like meta content.
    transformIndexHtml: { order: "pre", handler: (html) => html.replaceAll("__SITE_URL__", SITE) },
    generateBundle() {
      const day = new Date().toISOString().slice(0, 10);
      const urls = ROUTES.map(
        (r) => `  <url>\n    <loc>${SITE}${r === "/" ? "/" : r}</loc>\n    <lastmod>${day}</lastmod>\n    <priority>${r === "/" ? "1.0" : r.startsWith("/attacks/") ? "0.5" : "0.8"}</priority>\n  </url>`,
      ).join("\n");
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n` });
    },
  };
}

export default defineConfig({
  plugins: [react(), seoFiles()],
  define: { __SITE_URL__: JSON.stringify(SITE) },
});
