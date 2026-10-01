import assert from "node:assert";
import {
  generateResetToken,
  hashResetToken,
  resetTokenHashesMatch,
} from "./resetToken";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test("generateResetToken produces a 64-char hex string (32 bytes)", () => {
  const token = generateResetToken();
  assert.equal(token.length, 64);
  assert.match(token, /^[0-9a-f]{64}$/);
});

test("generateResetToken produces different tokens each call", () => {
  const a = generateResetToken();
  const b = generateResetToken();
  assert.notEqual(a, b);
});

test("hashResetToken is deterministic for the same input", () => {
  const token = generateResetToken();
  assert.equal(hashResetToken(token), hashResetToken(token));
});

test("hashResetToken produces different hashes for different tokens", () => {
  const a = generateResetToken();
  const b = generateResetToken();
  assert.notEqual(hashResetToken(a), hashResetToken(b));
});

test("hashResetToken output is a 64-char hex string (SHA-256)", () => {
  const hash = hashResetToken(generateResetToken());
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("resetTokenHashesMatch returns true for identical hashes", () => {
  const hash = hashResetToken(generateResetToken());
  assert.equal(resetTokenHashesMatch(hash, hash), true);
});

test("resetTokenHashesMatch returns false for different hashes", () => {
  const a = hashResetToken(generateResetToken());
  const b = hashResetToken(generateResetToken());
  assert.equal(resetTokenHashesMatch(a, b), false);
});

test("resetTokenHashesMatch returns false (not throws) for mismatched lengths", () => {
  assert.equal(resetTokenHashesMatch("abcd", "abcdef12"), false);
  assert.equal(resetTokenHashesMatch("", ""), true); // both empty buffers, trivially equal
});

console.log(`\n${passed} tests passed.`);
