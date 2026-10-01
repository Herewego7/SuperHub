import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

// The raw token is what goes in the emailed link — 256 bits of randomness,
// infeasible to guess/brute-force even without rate limiting. Only its
// SHA-256 hash is ever persisted (see passwordResetTokens schema), so a
// database leak alone can't be used to reset anyone's password.
export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Constant-time comparison of two hex hash strings (defense in depth; the
// hash itself already isn't guessable, but this avoids any hash-comparison
// timing side channel on top of that).
export function resetTokenHashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
