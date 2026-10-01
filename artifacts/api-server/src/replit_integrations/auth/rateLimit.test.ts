import assert from "node:assert";
import { checkRateLimit, _resetRateLimitsForTest } from "./rateLimit";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

_resetRateLimitsForTest();

test("allows requests up to the limit", () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit("key-a", 5, 60_000), true, `attempt ${i + 1} should pass`);
  }
});

test("blocks requests once the limit is exceeded", () => {
  assert.equal(checkRateLimit("key-a", 5, 60_000), false);
});

test("different keys have independent buckets", () => {
  assert.equal(checkRateLimit("key-b", 5, 60_000), true);
});

test("resets after the window elapses", () => {
  const key = "key-c";
  assert.equal(checkRateLimit(key, 1, 50), true);
  assert.equal(checkRateLimit(key, 1, 50), false);
  const start = Date.now();
  while (Date.now() - start < 60) {
    /* busy-wait past the 50ms window */
  }
  assert.equal(checkRateLimit(key, 1, 50), true);
});

console.log(`\n${passed} tests passed.`);
