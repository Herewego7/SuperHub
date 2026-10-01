import type { Express, Request } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { buildBriefsForUser, buildDailyBrief } from "../lib/dailyBrief";
import { db } from "../db";
import { profiles } from "@workspace/db";
import { and, eq } from "drizzle-orm";

function getUserId(req: Request): string | null {
  const u = (req as unknown as { user?: { claims?: { sub?: string } } }).user;
  return u?.claims?.sub ?? null;
}

export function registerDailyBriefRoutes(app: Express): void {
  // GET /api/daily-brief — returns the brief for whole-family + every profile
  // GET /api/daily-brief?profileId=xyz — returns just that profile's brief
  app.get("/api/daily-brief", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });

    const profileId = typeof req.query.profileId === "string" ? req.query.profileId : null;
    try {
      if (profileId) {
        const owned = await db
          .select()
          .from(profiles)
          .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId)))
          .limit(1);
        if (!owned[0]) return res.status(404).json({ error: "Profile not found" });
        const brief = await buildDailyBrief(userId, owned[0]);
        return res.json(brief);
      }
      const briefs = await buildBriefsForUser(userId);
      res.json(briefs);
    } catch (err) {
      console.error("Daily brief error:", err);
      res.status(500).json({ error: "Failed to build daily brief" });
    }
  });
}
