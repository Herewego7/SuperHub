import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// A bare fetch("/api/...") works on the web and fails silently in the native
// app: the Capacitor webview runs at capacitor://localhost, so a relative path
// resolves against the local bundle rather than the backend, and carries no
// bearer token. Everything goes through apiRequest/apiUrl for that reason.
//
// This has now bitten twice — bonus chores never appearing (2026-07-13), and
// celebrations never appearing on the calendar (2026-09-04) — each time from a
// NEW call site written after the previous sweep. Hence a standing check
// rather than another one-off fix.
// ---------------------------------------------------------------------------
const SRC = new URL("../../src", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("no frontend code fetches an app endpoint without apiUrl", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      // Comments are skipped: several of them quote the bad pattern to explain
      // why it was removed.
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*/, "");
      if (!/(^|[^A-Za-z_.$])fetch\s*\(/.test(code)) return;
      // Fine: routed through apiUrl (which is what apiRequest and the default
      // queryFn use), or an explicitly absolute URL.
      if (/apiUrl\s*\(/.test(code)) return;
      if (/https?:\/\/|import\.meta\.env\.BASE_URL/.test(code)) return;
      offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], "use apiRequest / apiUrl — a relative path breaks in the native app");
});
