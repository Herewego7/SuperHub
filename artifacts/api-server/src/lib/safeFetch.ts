import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import ipaddr from "ipaddr.js";

/**
 * SSRF-hardened fetcher for URLs supplied by users.
 *
 * Extracted verbatim from the ICS-import implementation in
 * `calendarImport.ts` (which is now a thin wrapper over this) so the recipe
 * URL importer reuses exactly the same, already-proven hardening rather than
 * growing a second, subtly-weaker copy. The protections, in order:
 *
 *  1. **Protocol allowlist** — http(s) only, so `file://`, `gopher://` etc.
 *     can't be used to read local files or reach odd services.
 *  2. **Public-IP-only, via ipaddr.js range classification** — an *allowlist*
 *     of globally-routable unicast, so loopback, link-local (incl. the
 *     169.254.169.254 cloud metadata endpoint), private ranges, ULA,
 *     multicast and reserved space are all refused. Unparseable addresses
 *     are refused rather than allowed.
 *  3. **DNS pinning** — the socket is forced to connect to the exact IP that
 *     was validated, which closes the DNS-rebinding TOCTOU window where a
 *     hostname resolves public during the check and private a moment later.
 *  4. **Per-hop redirect re-validation** — redirects are followed manually so
 *     every hop goes through 1–3 again; an open redirect on a public host
 *     therefore can't bounce the request onto an internal address.
 *  5. **Size cap + timeouts** — a hostile or accidental huge/slow response
 *     can't exhaust memory or hang the request.
 */

/**
 * Robust private/internal IP classification using ipaddr.js. Handles all
 * canonical IPv6 forms (including IPv4-mapped variants like ::ffff:7f00:1).
 */
function isPrivateAddress(addr: string): boolean {
  let parsed;
  try {
    parsed = ipaddr.parse(addr);
  } catch {
    // Unparseable: refuse rather than allow.
    return true;
  }
  // Convert IPv4-mapped/compatible IPv6 down to IPv4 so the v4 ranges apply.
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  const range = parsed.range();
  // Allow-list: only globally routable unicast may be dialed. Anything else
  // (loopback, link-local, private, ULA, multicast, reserved, etc.) is blocked.
  return range !== "unicast";
}

const MAX_REDIRECTS = 3;

interface PinnedAddress { address: string; family: 4 | 6 }

/**
 * Builds the `connect.lookup` callback that pins the socket to already-
 * validated public addresses.
 *
 * ⚠️ It MUST honour `options.all`. Node 20+ enables `autoSelectFamily`
 * (Happy Eyeballs) by default, and in that mode net.connect calls a custom
 * lookup with `{ all: true }` and expects an ARRAY of {address, family}.
 * Returning the older `(err, address, family)` triple there makes Node reject
 * the result with ERR_INVALID_IP_ADDRESS, which undici then collapses into an
 * opaque "fetch failed" — that silently broke EVERY safeFetch call (recipe
 * URL import AND iCal subscription import) on Node 20+. Both shapes are
 * handled so this can't regress if the flag ever flips back.
 *
 * Exported for the regression test; not part of the module's real API.
 */
export function makePinnedLookup(pinned: PinnedAddress[]) {
  return (_hostname: string, options: any, callback: any) => {
    if (options?.all) return callback(null, pinned);
    const first = pinned[0];
    return callback(null, first.address, first.family);
  };
}

/** IPv4 first — see resolvePublicIp. Exported for the regression test. */
export function orderPinnedAddresses(addrs: PinnedAddress[]): PinnedAddress[] {
  return [...addrs].sort((a, b) => a.family - b.family);
}

/**
 * Resolve a hostname to a single public IP and reject any answer that
 * includes a private/internal address. Returns the address+family the
 * caller must pin the socket connection to.
 */
async function resolvePublicIp(hostname: string): Promise<PinnedAddress[]> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Refusing to fetch from a private/internal address");
    }
    return [{ address: hostname, family: isIP(hostname) === 6 ? 6 : 4 }];
  }
  let resolved;
  try {
    resolved = await lookup(hostname, { all: true });
  } catch {
    throw new Error("Could not resolve that host");
  }
  if (!resolved.length) throw new Error("No DNS records for that host");
  for (const r of resolved) {
    if (isPrivateAddress(r.address)) {
      throw new Error("That host resolves to a private/internal address");
    }
  }
  // Every address here has been validated as public, so pinning to all of
  // them (rather than just the first) is equally safe and lets Node's
  // Happy Eyeballs try the next one if the first is unreachable. IPv4 first:
  // plenty of containers have an IPv6 address configured but no routable IPv6
  // path, and a v6-first pin would stall on every dual-stack host.
  return orderPinnedAddresses(
    resolved.map((r) => ({
      address: r.address,
      family: (r.family === 6 ? 6 : 4) as 4 | 6,
    })),
  );
}

/**
 * Thrown for a non-2xx/3xx HTTP response, carrying the actual status code so
 * a caller can react to *specific* statuses (e.g. "403/429 usually means a
 * bot-blocking WAF, say so plainly") instead of pattern-matching the message.
 */
export class HttpStatusError extends Error {
  constructor(public readonly status: number, label: string) {
    super(`Failed to fetch ${label}: HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}

export interface SafeFetchOptions {
  /** Value for the Accept header. */
  accept: string;
  /** Hard cap on the response body, in bytes. */
  maxBytes: number;
  /** Sent as User-Agent — some sites 403 an unidentified client. */
  userAgent?: string;
  /** Error text prefix, so callers can produce domain-specific messages. */
  label?: string;
}

/**
 * Fetch a user-supplied URL as text, with every protection described above.
 * Returns the body plus the final URL after any redirects (useful for
 * attribution — the page that actually served the content).
 */
/**
 * undici collapses every transport-level failure into `TypeError: fetch
 * failed` and hides the real reason in `.cause` — which is what made the
 * ERR_INVALID_IP_ADDRESS bug above so hard to see from a user report ("Fetch
 * failed" was all anyone, including the server log, ever saw). Unwrap it.
 */
async function fetchOrExplain(url: string, init: Parameters<typeof undiciFetch>[1]) {
  try {
    return await undiciFetch(url, init);
  } catch (err: any) {
    const code = err?.cause?.code || err?.code;
    const detail = code || err?.cause?.message || err?.message || "unknown error";
    const e = new Error(`Couldn't reach that site (${detail})`);
    (e as any).cause = err;
    throw e;
  }
}

export async function safeFetchText(
  initialUrl: string,
  opts: SafeFetchOptions,
): Promise<{ text: string; finalUrl: string }> {
  const label = opts.label ?? "content";
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl);
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error("Only http(s) URLs are allowed");
    }
    // Resolve and pin the IP for *this* hop. The custom undici Agent forces
    // the socket to connect to the validated IP, eliminating the DNS-rebinding
    // TOCTOU window between validation and connection.
    // URL.hostname keeps the brackets on an IPv6 literal ("[::1]"), which
    // isIP() doesn't accept — without stripping them an IPv6 literal falls
    // through to a DNS lookup that fails. That fails *closed* (so it was
    // never a security hole), but it also meant a legitimate public IPv6
    // literal could never be fetched, and a private one was rejected with a
    // misleading "could not resolve" message.
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    const pinned = await resolvePublicIp(hostname);
    const agent = new Agent({
      connect: { lookup: makePinnedLookup(pinned) },
      headersTimeout: 20000,
      bodyTimeout: 30000,
    });
    try {
      const response = await fetchOrExplain(currentUrl, {
        headers: {
          Accept: opts.accept,
          ...(opts.userAgent ? { "User-Agent": opts.userAgent } : {}),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        dispatcher: agent,
      });
      if (response.status >= 300 && response.status < 400) {
        const loc = response.headers.get("location");
        if (!loc) throw new Error("Redirect without Location header");
        currentUrl = new URL(loc, currentUrl).toString();
        // drain
        try { await response.body?.cancel(); } catch {}
        continue;
      }
      if (!response.ok) {
        throw new HttpStatusError(response.status, label);
      }
      if (!response.body) return { text: await response.text(), finalUrl: currentUrl };
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > opts.maxBytes) {
            try { await reader.cancel(); } catch {}
            throw new Error(`That ${label} is too large`);
          }
          chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        }
      }
      return { text: Buffer.concat(chunks).toString("utf-8"), finalUrl: currentUrl };
    } finally {
      try { await agent.close(); } catch {}
    }
  }
  throw new Error(`Too many redirects fetching ${label}`);
}
