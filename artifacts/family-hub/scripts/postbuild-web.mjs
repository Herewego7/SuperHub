/**
 * Put the marketing site at "/" and the app at "/app.html", after the web
 * build.
 *
 * WHY THIS EXISTS RATHER THAN A REWRITE (2026-09-17): the deployment serves
 * dist/public statically with a "/*" -> "/index.html" fallback, and a rewrite
 * is only consulted when no real file matches the path. index.html exists, so
 * "/" always resolved to it and an added `from = "/"` rule never fired — the
 * marketing page simply never appeared. Renaming the files is the one change
 * that does not depend on how the static server orders rules.
 *
 * ⚠️ Deliberately NOT part of `build:mobile`. The native app loads
 * index.html from capacitor://localhost and must keep getting the APP there,
 * not the marketing page.
 */
import { copyFile, rename, access } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(import.meta.dirname, "..", "dist", "public");
const appHtml = path.join(OUT, "app.html");
const indexHtml = path.join(OUT, "index.html");
const siteHtml = path.join(OUT, "site.html");

await access(siteHtml).catch(() => {
  throw new Error(
    "dist/public/site.html is missing — the marketing page should have been " +
    "copied from public/. Refusing to rename index.html and leave no app.",
  );
});

// The app moves aside first, so a failure here cannot leave the deployment
// with no index.html at all.
await rename(indexHtml, appHtml);
await copyFile(siteHtml, indexHtml);

console.log("postbuild: / -> marketing site, /app.html -> app");
