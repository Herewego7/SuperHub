import assert from "node:assert/strict";
import test from "node:test";
import { unreadCount } from "../../src/lib/chatThread";

test("a seeded unread reply is a badge count", () => {
  assert.equal(unreadCount("1"), 1);
  assert.equal(unreadCount("no"), 0);
  assert.equal(unreadCount(null), 0);
});
