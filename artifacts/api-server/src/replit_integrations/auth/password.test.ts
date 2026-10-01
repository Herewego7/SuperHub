import assert from "node:assert";
import {
  hashPassword,
  verifyPassword,
  isValidEmail,
  isValidPassword,
} from "./password";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main() {
  await test("hashPassword produces a salt:hash pair", async () => {
    const stored = await hashPassword("correct horse battery staple");
    const parts = stored.split(":");
    assert.equal(parts.length, 2);
    assert.equal(parts[0].length, 32); // 16-byte salt as hex
    assert.equal(parts[1].length, 128); // 64-byte key as hex
  });

  await test("verifyPassword accepts the correct password", async () => {
    const stored = await hashPassword("hunter2!");
    assert.equal(await verifyPassword("hunter2!", stored), true);
  });

  await test("verifyPassword rejects an incorrect password", async () => {
    const stored = await hashPassword("hunter2!");
    assert.equal(await verifyPassword("hunter3!", stored), false);
  });

  await test("verifyPassword rejects malformed stored values instead of throwing", async () => {
    assert.equal(await verifyPassword("anything", "not-a-valid-format"), false);
    assert.equal(await verifyPassword("anything", ""), false);
  });

  await test("two hashes of the same password are different (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("same-password", a), true);
    assert.equal(await verifyPassword("same-password", b), true);
  });

  await test("isValidEmail accepts normal addresses and rejects garbage", () => {
    assert.equal(isValidEmail("a@b.com"), true);
    assert.equal(isValidEmail("first.last+tag@example.co.uk"), true);
    assert.equal(isValidEmail("not-an-email"), false);
    assert.equal(isValidEmail("missing@domain"), false);
    assert.equal(isValidEmail("@missing-local.com"), false);
    assert.equal(isValidEmail("a".repeat(250) + "@b.com"), false);
  });

  await test("isValidPassword enforces an 8-256 character range", () => {
    assert.equal(isValidPassword("1234567"), false); // 7 chars
    assert.equal(isValidPassword("12345678"), true); // 8 chars
    assert.equal(isValidPassword("a".repeat(256)), true);
    assert.equal(isValidPassword("a".repeat(257)), false);
  });

  console.log(`\n${passed} tests passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
