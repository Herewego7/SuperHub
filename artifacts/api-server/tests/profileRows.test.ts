import assert from "node:assert/strict";
import test from "node:test";
import { factsColumnMissing } from "../src/lib/profileRows.ts";

test("a missing facts column is the database error, not any other failure", () => {
  const error = new Error("Failed query");
  error.cause = new Error('column "facts" does not exist');
  assert.equal(factsColumnMissing(error), true);
  assert.equal(factsColumnMissing(new Error("connection refused")), false);
});
