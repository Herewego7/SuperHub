// The app starts from its own files. A stylesheet or script on another site
// holds the first paint until that site answers, and the bundled iPhone app
// waits on it with no network at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

test("index.html loads nothing from another site at launch", () => {
  const html = read("index.html");
  assert.ok(html.includes('id="root"'), "expected the app's index.html");
  const remote = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)=["'](?:https?:)?\/\/[^"']+["'][^>]*>/gi)].map((match) => match[0]);
  assert.deepEqual(remote, []);
});

test("index.css imports nothing from another site", () => {
  const css = read("src/index.css");
  assert.ok(css.includes(".hearth-theme"), "expected the app's stylesheet");
  const imports = [...css.matchAll(/@import\s+url\(\s*["']?(?:https?:)?\/\/[^)]*\)/gi)].map((match) => match[0]);
  assert.deepEqual(imports, []);
});

test("the remote-tag patterns catch the tags they are written for", () => {
  const html = '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><script src="https://replit.com/banner.js"></script><script src="/src/main.tsx"></script>';
  const tags = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)=["'](?:https?:)?\/\/[^"']+["'][^>]*>/gi)];
  assert.equal(tags.length, 2);
  const css = "@import url('https://fonts.googleapis.com/css2?family=Inter');\n@import './local.css';";
  assert.equal([...css.matchAll(/@import\s+url\(\s*["']?(?:https?:)?\/\/[^)]*\)/gi)].length, 1);
});
