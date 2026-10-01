import {
  db,
  families,
  familyMembers,
  familyInvitations,
  users,
  type Family,
  type FamilyMember,
  type FamilyInvitation,
} from "@workspace/db";
import { and, eq, isNull, or, gt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { storage } from "./storage";
import { startGraceIfCoveringMemberLeaves } from "./lib/subscriptionEntitlement";
import { sendPushToUser } from "./lib/push";

export type ResolvedFamily = {
  familyId: string;
  ownerUserId: string;
  role: string; // "owner" | "member"
};

// ─── Resolution cache ────────────────────────────────────────────────────────
// getUserId() is called on every request via middleware. Resolving the family
// from the DB each time would add a query per request, so we cache the mapping
// authUserId → ResolvedFamily for a short TTL. Invalidated on join/leave/create.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: ResolvedFamily; expires: number }>();

export function invalidateFamilyCache(authUserId: string): void {
  cache.delete(authUserId);
}

/**
 * Resolve the family for a logged-in account, auto-creating a self-owned family
 * if the account has no membership yet (covers brand-new users AND existing
 * users from before the family feature). This guarantees getUserId() always
 * returns a valid owner id, preserving single-family behavior for everyone.
 */
export async function resolveFamilyForAccount(authUserId: string): Promise<ResolvedFamily> {
  const cached = cache.get(authUserId);
  if (cached && cached.expires > Date.now()) return cached.value;

  let resolved = await lookupFamily(authUserId);
  if (!resolved) {
    resolved = await createSoloFamily(authUserId);
  }
  cache.set(authUserId, { value: resolved, expires: Date.now() + CACHE_TTL_MS });
  return resolved;
}

async function lookupFamily(authUserId: string): Promise<ResolvedFamily | null> {
  const [member] = await db
    .select()
    .from(familyMembers)
    .where(eq(familyMembers.userId, authUserId));
  if (!member) return null;

  const [family] = await db
    .select()
    .from(families)
    .where(eq(families.id, member.familyId));
  if (!family) return null;

  return { familyId: family.id, ownerUserId: family.ownerUserId, role: member.role };
}

async function createSoloFamily(authUserId: string): Promise<ResolvedFamily> {
  // Best-effort family name from the user's name.
  let name = "My Family";
  try {
    const [u] = await db.select().from(users).where(eq(users.id, authUserId));
    const first = u?.firstName || u?.displayName;
    if (first) name = `${first}'s Family`;
  } catch {
    /* fall back to default */
  }

  const [family] = await db
    .insert(families)
    .values({ name, ownerUserId: authUserId })
    .returning();

  await db
    .insert(familyMembers)
    .values({ familyId: family.id, userId: authUserId, role: "owner" })
    .onConflictDoNothing();

  return { familyId: family.id, ownerUserId: authUserId, role: "owner" };
}

// ─── Family info ─────────────────────────────────────────────────────────────

export type FamilyMemberInfo = {
  userId: string;
  role: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  isYou: boolean;
};

// Every logged-in account in the family that owns `dataOwnerUserId`'s data
// (legacy tables are all keyed by the family owner's account id — see the
// family-model note at the top of this file). Used for notifications that
// should reach "the parents": every family member is a distinct login
// account managing the household, so this is every account, not just the
// nominal "owner" — a spouse who joined via invite code is just as much a
// parent as the person who created the family.
export async function getFamilyMemberAccountIds(dataOwnerUserId: string): Promise<string[]> {
  const resolved = await resolveFamilyForAccount(dataOwnerUserId);
  const members = await db
    .select({ userId: familyMembers.userId })
    .from(familyMembers)
    .where(eq(familyMembers.familyId, resolved.familyId));
  return members.map((m) => m.userId);
}

export async function getFamilyDetails(authUserId: string): Promise<{
  family: Family;
  role: string;
  isOwner: boolean;
  members: FamilyMemberInfo[];
}> {
  const resolved = await resolveFamilyForAccount(authUserId);
  const [family] = await db.select().from(families).where(eq(families.id, resolved.familyId));

  const memberRows = await db
    .select()
    .from(familyMembers)
    .where(eq(familyMembers.familyId, resolved.familyId));

  const members: FamilyMemberInfo[] = [];
  for (const m of memberRows) {
    const [u] = await db.select().from(users).where(eq(users.id, m.userId));
    members.push({
      userId: m.userId,
      role: m.role,
      email: u?.email ?? null,
      firstName: u?.firstName ?? null,
      lastName: u?.lastName ?? null,
      displayName: u?.displayName ?? null,
      profileImageUrl: u?.profileImageUrl ?? null,
      isYou: m.userId === authUserId,
    });
  }
  // Owner first, then alphabetical-ish by name.
  members.sort((a, b) => {
    if (a.role === "owner" && b.role !== "owner") return -1;
    if (b.role === "owner" && a.role !== "owner") return 1;
    return (a.firstName ?? a.email ?? "").localeCompare(b.firstName ?? b.email ?? "");
  });

  return {
    family,
    role: resolved.role,
    isOwner: resolved.role === "owner",
    members,
  };
}

export async function renameFamily(authUserId: string, name: string): Promise<Family> {
  const resolved = await resolveFamilyForAccount(authUserId);
  if (resolved.role !== "owner") {
    throw new FamilyError(403, "Only the family owner can rename the family");
  }
  const trimmed = name.trim();
  if (!trimmed) throw new FamilyError(400, "Family name cannot be empty");
  const [updated] = await db
    .update(families)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(families.id, resolved.familyId))
    .returning();
  return updated;
}

// ─── Invitations ─────────────────────────────────────────────────────────────

function generateCode(): string {
  // 8-char uppercase alphanumeric, ambiguous chars removed.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export type InviteeRole = "parent" | "child" | "shared_device";

export async function createInvite(
  authUserId: string,
  email?: string | null,
  inviteeRole?: InviteeRole | null,
): Promise<FamilyInvitation> {
  const resolved = await resolveFamilyForAccount(authUserId);
  // Any member may invite; tighten to owner-only later if desired.
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
  const [invite] = await db
    .insert(familyInvitations)
    .values({
      familyId: resolved.familyId,
      code,
      createdByUserId: authUserId,
      email: email?.trim() || null,
      inviteeRole: inviteeRole || null,
      expiresAt,
    })
    .returning();
  return invite;
}

export async function listInvites(authUserId: string): Promise<FamilyInvitation[]> {
  const resolved = await resolveFamilyForAccount(authUserId);
  return db
    .select()
    .from(familyInvitations)
    .where(
      and(
        eq(familyInvitations.familyId, resolved.familyId),
        isNull(familyInvitations.acceptedAt),
        isNull(familyInvitations.revokedAt),
        // An expired-but-never-accepted invite is dead the same way a
        // revoked one is — nobody can use the code anymore — so it's
        // excluded here the same way, rather than sitting in the list
        // forever just to display "Expired" next to a Copy/Revoke row that
        // no longer does anything useful. Rows with no expiresAt (null)
        // never expire, so they're always kept.
        or(isNull(familyInvitations.expiresAt), gt(familyInvitations.expiresAt, new Date())),
      ),
    );
}

export async function revokeInvite(authUserId: string, inviteId: string): Promise<void> {
  const resolved = await resolveFamilyForAccount(authUserId);
  const [invite] = await db
    .select()
    .from(familyInvitations)
    .where(eq(familyInvitations.id, inviteId));
  if (!invite || invite.familyId !== resolved.familyId) {
    throw new FamilyError(404, "Invitation not found");
  }
  await db
    .update(familyInvitations)
    .set({ revokedAt: new Date() })
    .where(eq(familyInvitations.id, inviteId));
}

/**
 * The inviteeRole from the invite this account most recently accepted (null
 * for family creators / pre-role invites). Lets a joiner's onboarding
 * default their own profile to Grown-up/Kid without a Settings trip.
 */
export async function getMyInviteRole(authUserId: string): Promise<InviteeRole | null> {
  const rows = await db
    .select({ inviteeRole: familyInvitations.inviteeRole, acceptedAt: familyInvitations.acceptedAt })
    .from(familyInvitations)
    .where(eq(familyInvitations.acceptedByUserId, authUserId));
  if (rows.length === 0) return null;
  rows.sort((a, b) => (b.acceptedAt?.getTime() ?? 0) - (a.acceptedAt?.getTime() ?? 0));
  return (rows[0].inviteeRole as InviteeRole | null) ?? null;
}

export type InviteLookupResult =
  | { valid: false; reason: string }
  | { valid: true; email: string | null; hasAccount: boolean; familyName: string | null };

/**
 * Public, unauthenticated lookup used by the sign-up/login screen when someone
 * types in a raw invite code (rather than clicking the emailed link) — lets it
 * decide whether to route them to Sign Up or Log In. Deliberately returns only
 * a yes/no `hasAccount`, never anything else about that account.
 */
export async function lookupInvite(code: string): Promise<InviteLookupResult> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { valid: false, reason: "Invite code is required" };
  const [invite] = await db
    .select()
    .from(familyInvitations)
    .where(eq(familyInvitations.code, normalized));

  if (!invite) return { valid: false, reason: "Invalid invite code" };
  if (invite.revokedAt) return { valid: false, reason: "This invite has been revoked" };
  if (invite.acceptedAt) return { valid: false, reason: "This invite has already been used" };
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return { valid: false, reason: "This invite has expired" };
  }

  let hasAccount = false;
  if (invite.email) {
    const existing = await db.select().from(users).where(eq(users.email, invite.email.toLowerCase()));
    hasAccount = existing.length > 0;
  }
  // The family's display name, so the join-confirmation screen can say WHICH
  // family this code belongs to instead of an anonymous "Join this family?".
  // Only ever revealed for a currently-valid code — the code itself is the
  // secret that gates this.
  const [family] = await db.select().from(families).where(eq(families.id, invite.familyId));
  return { valid: true, email: invite.email ?? null, hasAccount, familyName: family?.name ?? null };
}

/**
 * Accept an invite code: move the account into the target family. If the account
 * currently owns a throwaway solo family (it's the only member), that family and
 * its data are deleted to avoid orphans. Returns the new resolved family.
 */
export async function joinFamily(authUserId: string, code: string): Promise<ResolvedFamily> {
  const normalized = code.trim().toUpperCase();
  const [invite] = await db
    .select()
    .from(familyInvitations)
    .where(eq(familyInvitations.code, normalized));

  if (!invite) throw new FamilyError(404, "Invalid invite code");
  if (invite.revokedAt) throw new FamilyError(410, "This invite has been revoked");
  if (invite.acceptedAt) throw new FamilyError(410, "This invite has already been used");
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    throw new FamilyError(410, "This invite has expired");
  }

  const current = await lookupFamily(authUserId);

  // Already in the target family — no-op success.
  if (current && current.familyId === invite.familyId) {
    return current;
  }

  // Pure-read precondition, checked BEFORE claiming the invite so a doomed
  // join doesn't consume the code: an owner of a shared family can't abandon
  // its other members.
  if (current && current.role === "owner") {
    const otherMembers = await db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.familyId, current.familyId));
    if (!(otherMembers.length === 1 && otherMembers[0].userId === authUserId)) {
      throw new FamilyError(
        409,
        "You own a family with other members. Transfer ownership or remove members before joining another family.",
      );
    }
  }

  // Atomically claim the invite FIRST (single-use enforcement). The initial
  // acceptedAt check above is only advisory — two concurrent joins with the
  // same code could both pass it, so the UPDATE itself re-checks under the
  // row lock and only one caller wins.
  const claimed = await db
    .update(familyInvitations)
    .set({ acceptedAt: new Date(), acceptedByUserId: authUserId })
    .where(and(
      eq(familyInvitations.id, invite.id),
      isNull(familyInvitations.acceptedAt),
      isNull(familyInvitations.revokedAt),
    ))
    .returning({ id: familyInvitations.id });
  if (claimed.length === 0) throw new FamilyError(410, "This invite has already been used");

  try {
    // If the account owns a solo family (sole member), tear it down so its data
    // doesn't linger orphaned. This is the one destructive path — the UI warns.
    if (current && current.role === "owner") {
      // Delete the owner's data, then the membership + family row.
      try {
        await storage.resetUserData(authUserId);
      } catch (err) {
        // Best-effort, but never silent: an error here means the old family's
        // rows are being left behind (orphaned) while the account moves on.
        console.error("joinFamily: solo-family data teardown failed, continuing with structural cleanup:", err);
      }
      await db.delete(familyMembers).where(eq(familyMembers.familyId, current.familyId));
      await db.delete(families).where(eq(families.id, current.familyId));
    } else if (current) {
      // Plain member of another family — just drop the membership. Same grace
      // rule as leaveFamily: moving households is a departure from the old one.
      await startGraceIfCoveringMemberLeaves(authUserId, current.familyId);
      await db
        .delete(familyMembers)
        .where(and(eq(familyMembers.userId, authUserId), eq(familyMembers.familyId, current.familyId)));
    }

    await db
      .insert(familyMembers)
      .values({ familyId: invite.familyId, userId: authUserId, role: "member" })
      .onConflictDoUpdate({
        target: familyMembers.userId,
        set: { familyId: invite.familyId, role: "member" },
      });
  } catch (err) {
    // The join itself failed after the code was claimed — release the claim
    // (best-effort) so a legitimate retry isn't told the code is used up.
    await db
      .update(familyInvitations)
      .set({ acceptedAt: null, acceptedByUserId: null })
      .where(eq(familyInvitations.id, invite.id))
      .catch(() => {});
    throw err;
  }

  invalidateFamilyCache(authUserId);

  const [family] = await db.select().from(families).where(eq(families.id, invite.familyId));

  // Best-effort: let the inviter know their invite was accepted. Must never
  // fail the join itself (the account is already moved into the family by
  // this point regardless of whether the notification succeeds).
  try {
    const [accepter] = await db.select().from(users).where(eq(users.id, authUserId));
    const accepterName = accepter?.firstName || accepter?.displayName || accepter?.email || "Someone";
    await sendPushToUser(
      { userId: invite.createdByUserId },
      {
        title: `${accepterName} joined your family!`,
        body: `Welcome to ${family?.name ?? "your family"}`,
        url: "/",
        tag: `invite-accepted-${invite.id}`,
        data: { kind: "invite-accepted", inviteId: invite.id, newMemberId: authUserId },
      },
      "inviteAccepted",
    );
  } catch (err) {
    console.error("Failed to send invite-accepted notification:", err);
  }

  return { familyId: invite.familyId, ownerUserId: family.ownerUserId, role: "member" };
}

export async function removeMember(authUserId: string, targetUserId: string): Promise<void> {
  const resolved = await resolveFamilyForAccount(authUserId);
  if (resolved.role !== "owner") {
    throw new FamilyError(403, "Only the family owner can remove members");
  }
  if (targetUserId === authUserId) {
    throw new FamilyError(400, "The owner cannot remove themselves");
  }
  // Before the membership row goes: if this is the member whose subscription
  // or comp was covering the household, start the grace period so the family
  // isn't locked out mid-week with no warning.
  await startGraceIfCoveringMemberLeaves(targetUserId, resolved.familyId);
  await db
    .delete(familyMembers)
    .where(and(eq(familyMembers.userId, targetUserId), eq(familyMembers.familyId, resolved.familyId)));
  invalidateFamilyCache(targetUserId);
}

export async function leaveFamily(authUserId: string): Promise<void> {
  const resolved = await resolveFamilyForAccount(authUserId);
  if (resolved.role === "owner") {
    throw new FamilyError(
      409,
      "The family owner cannot leave. Transfer ownership or delete your account instead.",
    );
  }
  await startGraceIfCoveringMemberLeaves(authUserId, resolved.familyId);
  await db
    .delete(familyMembers)
    .where(and(eq(familyMembers.userId, authUserId), eq(familyMembers.familyId, resolved.familyId)));
  invalidateFamilyCache(authUserId);
  // On next request a fresh solo family is auto-created for this account.
}

// ─── Backfill ────────────────────────────────────────────────────────────────
// Ensure every existing user has a family + owner membership. Idempotent.
export async function backfillFamilies(): Promise<{ created: number }> {
  const allUsers = await db.select().from(users);
  let created = 0;
  for (const u of allUsers) {
    const [member] = await db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.userId, u.id));
    if (!member) {
      await createSoloFamily(u.id);
      created++;
    }
  }
  return { created };
}

export class FamilyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ─── Account deletion ────────────────────────────────────────────────────────
// Family-aware account deletion. "Account" = the logged-in login (authUserId),
// which is distinct from the family's data owner. getUserId() returns the family
// OWNER, so naive resetUserData(getUserId()) would wipe a shared family when a
// mere member deletes their account — this routes each case correctly.
export type DeleteAccountResult = {
  /** True when the family's shared data was also destroyed (owner, sole member). */
  dataDeleted: boolean;
};

export async function deleteAccount(authUserId: string): Promise<DeleteAccountResult> {
  const resolved = await lookupFamily(authUserId);

  // No membership row (shouldn't normally happen) — just remove the user record.
  if (!resolved) {
    await db.delete(users).where(eq(users.id, authUserId));
    invalidateFamilyCache(authUserId);
    return { dataDeleted: false };
  }

  if (resolved.role === "owner") {
    const memberRows = await db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.familyId, resolved.familyId));
    const others = memberRows.filter((m) => m.userId !== authUserId);

    if (others.length > 0) {
      throw new FamilyError(
        409,
        "You own a family shared with other members. Remove the other members (or transfer ownership) before deleting your account.",
      );
    }

    // Sole owner — destroy all family data, then the user row. Deleting the user
    // cascades to families → family_members → family_invitations.
    try {
      await storage.resetUserData(authUserId);
    } catch {
      /* best-effort; structural cleanup still proceeds via cascade */
    }
    await db.delete(users).where(eq(users.id, authUserId));
    invalidateFamilyCache(authUserId);
    return { dataDeleted: true };
  }

  // Plain member — leave the family (data belongs to the owner, untouched) and
  // remove the user record.
  await db
    .delete(familyMembers)
    .where(and(eq(familyMembers.userId, authUserId), eq(familyMembers.familyId, resolved.familyId)));
  await db.delete(users).where(eq(users.id, authUserId));
  invalidateFamilyCache(authUserId);
  return { dataDeleted: false };
}
