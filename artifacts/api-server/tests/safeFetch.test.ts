import { test } from "node:test";
import assert from "node:assert/strict";
import { makePinnedLookup, orderPinnedAddresses } from "../src/lib/safeFetch.ts";

/**
 * Regression: the DNS-pinning lookup callback ignored `options.all`, so on
 * Node 20+ (autoSelectFamily/Happy Eyeballs, on by default) net.connect
 * rejected the result with ERR_INVALID_IP_ADDRESS and undici reported the
 * opaque "fetch failed". That silently broke EVERY safeFetch caller —
 * recipe URL import and iCal subscription import both.
 */
test("pinned lookup returns an ARRAY when Node asks for all addresses", () => {
  const pinned = [
    { address: "93.184.216.34", family: 4 as const },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const },
  ];
  const lookup = makePinnedLookup(pinned);
  let result: any = "never called";
  lookup("example.com", { all: true }, (err: any, value: any) => {
    result = { err, value };
  });
  assert.equal(result.err, null);
  assert.ok(Array.isArray(result.value), "must hand back an array for all:true");
  assert.deepEqual(result.value, pinned);
});

test("pinned lookup still supports the legacy (address, family) triple", () => {
  const pinned = [{ address: "93.184.216.34", family: 4 as const }];
  let got: any = null;
  makePinnedLookup(pinned)("example.com", {}, (err: any, address: any, family: any) => {
    got = { err, address, family };
  });
  assert.deepEqual(got, { err: null, address: "93.184.216.34", family: 4 });
});

/**
 * IPv4 is tried first: plenty of containers have an IPv6 address configured
 * with no routable IPv6 path, and a v6-first pin stalls on dual-stack hosts.
 */
test("resolved addresses are ordered IPv4 first", () => {
  const ordered = orderPinnedAddresses([
    { address: "2606:2800::1", family: 6 },
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800::2", family: 6 },
    { address: "93.184.216.35", family: 4 },
  ]);
  assert.deepEqual(ordered.map((a) => a.family), [4, 4, 6, 6]);
  assert.equal(ordered[0].address, "93.184.216.34", "v4 order preserved among themselves");
});

test("ordering does not mutate the caller's array", () => {
  const input = [{ address: "2606:2800::1", family: 6 as const }, { address: "1.2.3.4", family: 4 as const }];
  orderPinnedAddresses(input);
  assert.equal(input[0].family, 6);
});
