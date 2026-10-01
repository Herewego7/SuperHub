import {
  users,
  passwordResetTokens,
  type User,
  type UpsertUser,
  type PasswordResetToken,
} from "@workspace/db";
import { db } from "../../db";
import { eq, lt } from "drizzle-orm";

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByAppleId(appleUserId: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  createUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, data: { displayName?: string }): Promise<User>;
  completeOnboarding(id: string): Promise<User>;
  updatePassword(id: string, passwordHash: string): Promise<User>;
  createPasswordResetToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetToken>;
  getPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | undefined>;
  deletePasswordResetTokensForUser(userId: string): Promise<void>;
  deleteExpiredPasswordResetTokens(): Promise<void>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  // Email lookups are case-insensitive since signup normalizes to lowercase,
  // but existing Replit-created rows may have mixed-case emails.
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async getUserByAppleId(appleUserId: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.appleUserId, appleUserId));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const { displayName, ...coreData } = userData as any;
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...coreData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Plain insert for brand-new local/Apple accounts — never touches an
  // existing row, unlike upsertUser (which is keyed for the OIDC re-login
  // path and must not be reused here to avoid clobbering another provider's
  // row on an id collision).
  async createUser(userData: UpsertUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async updateUser(id: string, data: { displayName?: string }): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async completeOnboarding(id: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updatePassword(id: string, passwordHash: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async createPasswordResetToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetToken> {
    const [row] = await db.insert(passwordResetTokens).values(data).returning();
    return row;
  }

  async getPasswordResetToken(tokenHash: string): Promise<PasswordResetToken | undefined> {
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash));
    return row;
  }

  // Called before issuing a new token (so only the most recently requested
  // reset link works) and after a successful reset (so a used/old token can
  // never be replayed).
  async deletePasswordResetTokensForUser(userId: string): Promise<void> {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  }

  // Best-effort housekeeping so the table doesn't grow unbounded with stale,
  // never-used tokens from abandoned reset requests.
  async deleteExpiredPasswordResetTokens(): Promise<void> {
    await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, new Date()));
  }
}

export const authStorage = new AuthStorage();
