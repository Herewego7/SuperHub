import type { Express } from "express";
import { isAuthenticated, authStorage } from "../replit_integrations/auth";
import {
  getFamilyDetails,
  renameFamily,
  createInvite,
  listInvites,
  revokeInvite,
  joinFamily,
  lookupInvite,
  getMyInviteRole,
  removeMember,
  leaveFamily,
  FamilyError,
  type InviteeRole,
} from "../familyService";

const VALID_INVITEE_ROLES: InviteeRole[] = ["parent", "child", "shared_device"];
import { checkRateLimit } from "../replit_integrations/auth/rateLimit";
import { sendEmail } from "../lib/email";
import { resolvePublicBaseUrl, escapeHtml } from "../lib/publicUrl";
import { isValidEmail } from "../replit_integrations/auth/password";

// Family-management endpoints act on the LOGGED-IN account, not the family
// owner, so they read req.user.claims.sub directly rather than getUserId().
function accountId(req: any): string {
  return req.user?.claims?.sub;
}

function handleError(res: any, error: unknown, fallback: string): void {
  if (error instanceof FamilyError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ message: fallback });
}

export function registerFamilyRoutes(app: Express): void {
  // Current family: name, members, my role
  app.get("/api/family", isAuthenticated, async (req: any, res) => {
    try {
      const details = await getFamilyDetails(accountId(req));
      res.json(details);
    } catch (error) {
      handleError(res, error, "Failed to fetch family");
    }
  });

  // Rename family (owner only)
  app.patch("/api/family", isAuthenticated, async (req: any, res) => {
    try {
      const { name } = req.body ?? {};
      const family = await renameFamily(accountId(req), String(name ?? ""));
      res.json(family);
    } catch (error) {
      handleError(res, error, "Failed to update family");
    }
  });

  // Create an invite code. If an email is provided, also send the invite
  // (code + join link) to that address — otherwise the code is just shown
  // in the UI for the owner to share manually (unchanged prior behavior).
  app.post("/api/family/invites", isAuthenticated, async (req: any, res) => {
    try {
      const { email, role } = req.body ?? {};
      if (email !== undefined && email !== null && email !== "") {
        if (typeof email !== "string" || !isValidEmail(email)) {
          res.status(400).json({ message: "Please enter a valid email address." });
          return;
        }
        // Rate-limit by inviter so one account can't be used to blast emails
        // at arbitrary addresses.
        if (!checkRateLimit(`invite:${accountId(req)}`, 20, 60 * 60 * 1000)) {
          res.status(429).json({ message: "Too many invites sent. Try again later." });
          return;
        }
      }
      if (role !== undefined && role !== null && !VALID_INVITEE_ROLES.includes(role)) {
        res.status(400).json({ message: "Invalid invitee role." });
        return;
      }

      const invite = await createInvite(accountId(req), email, role as InviteeRole | undefined);
      res.status(201).json(invite);

      // Fire the email after responding — the invite is already created and
      // usable even if delivery is slow or fails, and a slow email provider
      // shouldn't make the "New Invite" button feel stuck.
      if (invite.email) {
        try {
          const [inviter, details] = await Promise.all([
            authStorage.getUser(accountId(req)),
            getFamilyDetails(accountId(req)),
          ]);
          const inviterName = escapeHtml(
            inviter?.firstName || inviter?.displayName || "A family member",
          );
          const familyName = escapeHtml(details.family.name || "their family");
          const joinUrl = `${resolvePublicBaseUrl(req)}/join?code=${invite.code}`;
          const safeJoinUrl = escapeHtml(joinUrl);
          await sendEmail({
            to: invite.email,
            subject: `${inviterName} invited you to join ${familyName} on Family Hub+`,
            html: `<p>${inviterName} invited you to join <strong>${familyName}</strong> on Family Hub+.</p><p>Your invite code is:</p><p style="font-size:20px;font-weight:bold;letter-spacing:2px;">${invite.code}</p><p>Click below to sign up (or log in) and join automatically — this link expires in 14 days:</p><p><a href="${safeJoinUrl}">${safeJoinUrl}</a></p>`,
            text: `${inviterName} invited you to join ${familyName} on Family Hub+.\n\nYour invite code is: ${invite.code}\n\nSign up (or log in) and join automatically here (expires in 14 days):\n${joinUrl}`,
          });
        } catch (err) {
          console.error("[family invite] failed to send invite email:", err);
        }
      }
    } catch (error) {
      handleError(res, error, "Failed to create invite");
    }
  });

  // List active invites
  app.get("/api/family/invites", isAuthenticated, async (req: any, res) => {
    try {
      const invites = await listInvites(accountId(req));
      res.json(invites);
    } catch (error) {
      handleError(res, error, "Failed to list invites");
    }
  });

  // Revoke an invite
  app.delete("/api/family/invites/:id", isAuthenticated, async (req: any, res) => {
    try {
      await revokeInvite(accountId(req), req.params.id);
      res.status(204).send();
    } catch (error) {
      handleError(res, error, "Failed to revoke invite");
    }
  });

  // Public lookup for the sign-up/login screen's "Have an invite code?" field
  // — lets it decide whether to route the visitor to Sign Up or Log In before
  // they've authenticated at all. Rate-limited per-IP since it's unauthenticated
  // and would otherwise let someone brute-force-guess valid codes.
  app.get("/api/family/invites/lookup/:code", async (req: any, res) => {
    try {
      if (!checkRateLimit(`invite-lookup:${req.ip}`, 30, 60 * 1000)) {
        res.status(429).json({ valid: false, reason: "Too many attempts. Try again in a minute." });
        return;
      }
      const result = await lookupInvite(String(req.params.code ?? ""));
      res.json(result);
    } catch (error) {
      handleError(res, error, "Failed to look up invite");
    }
  });

  // The role (parent/child/shared_device) this account was invited as, if
  // any — used by a joiner's onboarding to preselect Grown-up/Kid on their
  // own new profile.
  app.get("/api/family/my-invite-role", isAuthenticated, async (req: any, res) => {
    try {
      const role = await getMyInviteRole(req.user.claims.sub);
      res.json({ role });
    } catch (error) {
      handleError(res, error, "Failed to look up invite role");
    }
  });

  // Accept an invite code → switch into that family
  app.post("/api/family/join", isAuthenticated, async (req: any, res) => {
    try {
      const { code } = req.body ?? {};
      if (!code || typeof code !== "string") {
        res.status(400).json({ message: "Invite code is required" });
        return;
      }
      const resolved = await joinFamily(accountId(req), code);
      res.json(resolved);
    } catch (error) {
      handleError(res, error, "Failed to join family");
    }
  });

  // Remove a member (owner only)
  app.post("/api/family/members/:userId/remove", isAuthenticated, async (req: any, res) => {
    try {
      await removeMember(accountId(req), req.params.userId);
      res.status(204).send();
    } catch (error) {
      handleError(res, error, "Failed to remove member");
    }
  });

  // Leave the current family (non-owner)
  app.post("/api/family/leave", isAuthenticated, async (req: any, res) => {
    try {
      await leaveFamily(accountId(req));
      res.status(204).send();
    } catch (error) {
      handleError(res, error, "Failed to leave family");
    }
  });
}
