import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user (augmented with family context)
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      // The auth middleware attaches family context (familyId/role) when a
      // resolver is configured. Surface it so the client can render family UI
      // and gate onboarding.
      const family = req.familyId
        ? {
            id: req.familyId,
            role: req.familyRole ?? "member",
            isOwner: req.familyRole === "owner",
          }
        : null;
      // Never send the password hash to the client, regardless of auth method.
      const { passwordHash: _passwordHash, ...safeUser } = (user ?? {}) as any;
      res.json({ ...safeUser, family });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Update current user's account info (display name only)
  app.patch("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { displayName } = req.body;
      const user = await authStorage.updateUser(userId, { displayName: displayName || null });
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Marks this account as having finished (or force-passed through) the
  // first-run onboarding wizard, so it isn't shown again — see the
  // `onboardingCompletedAt` column comment for why this is per-account
  // rather than per-family.
  app.post("/api/auth/complete-onboarding", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.completeOnboarding(userId);
      res.json(user);
    } catch (error) {
      console.error("Error completing onboarding:", error);
      res.status(500).json({ message: "Failed to complete onboarding" });
    }
  });
}
