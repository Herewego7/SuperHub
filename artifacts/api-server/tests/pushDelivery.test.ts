import assert from "node:assert/strict";
import test from "node:test";
import { pushReachedSomeone } from "../src/lib/pushDelivery.ts";

test("a push that reached nobody is retried, and a quiet send is kept", () => {
  assert.equal(pushReachedSomeone({ sent: 0, failed: 2 }), false);
  assert.equal(pushReachedSomeone({ sent: 0, failed: 0, nativeSent: 0, nativeFailed: 1 }), false);
  assert.equal(pushReachedSomeone({ sent: 1, failed: 1 }), true);
  assert.equal(pushReachedSomeone({ sent: 0, failed: 0 }), true);
});
