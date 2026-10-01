// Server-side mirror of the frontend's isKidProfile (lib/parentGate.tsx) —
// api-server doesn't share frontend code, so this is kept in sync by hand,
// same tradeoff already made for groceryMerge.ts.
export function isKidProfile(profile: { role?: string | null; isChild?: boolean | null } | undefined | null): boolean {
  if (!profile) return false;
  return profile.role === "child" || !!profile.isChild;
}
