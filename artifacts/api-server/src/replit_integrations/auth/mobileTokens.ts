import crypto from "node:crypto";

function getSecret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) {
    throw new Error(
      "SESSION_SECRET must be set to issue or verify mobile tokens",
    );
  }
  return s;
}
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type MobileTokenClaims = {
  sub: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  profile_image_url?: string;
  exp: number;
};

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  return Buffer.from(pad ? padded + "=".repeat(4 - pad) : padded, "base64");
}

export function signMobileToken(
  claims: Omit<MobileTokenClaims, "exp">,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: MobileTokenClaims = { ...claims, exp: now + TOKEN_TTL_SECONDS };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = b64url(
    crypto.createHmac("sha256", getSecret()).update(payloadB64).digest(),
  );
  return `${payloadB64}.${sig}`;
}

export function verifyMobileToken(token: string): MobileTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;
  const expectedSig = b64url(
    crypto.createHmac("sha256", getSecret()).update(payloadB64).digest(),
  );
  const expectedBuf = Buffer.from(expectedSig);
  const sigBuf = Buffer.from(sig);
  if (expectedBuf.length !== sigBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, sigBuf)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
    if (typeof payload?.sub !== "string") return null;
    if (typeof payload?.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as MobileTokenClaims;
  } catch {
    return null;
  }
}
