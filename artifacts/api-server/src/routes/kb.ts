import type { Express } from "express";
import { isAuthenticated, authStorage } from "../replit_integrations/auth";
import { checkRateLimit } from "../replit_integrations/auth/rateLimit";
import { sendEmail, isEmailConfigured } from "../lib/email";
import { escapeHtml } from "../lib/publicUrl";
import { db, kbQuestions } from "@workspace/db";

const SUPPORT_EMAIL = "chadcgiles@gmail.com";
const MAX_QUESTION_LENGTH = 2000;

function accountId(req: any): string {
  return req.user?.claims?.sub;
}

// Backlog storage + email-forward for the KB's "couldn't find my answer,
// ask us" flow. Deliberately separate from the KB articles themselves
// (which live as code in family-hub/src/kb/articles) — this is only a
// submissions log, so a human can spot duplicates and write the next article.
export function registerKbRoutes(app: Express): void {
  app.post("/api/kb/questions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = accountId(req);
      if (!checkRateLimit(`kb-ask:${userId}`, 5, 60 * 60 * 1000)) {
        res.status(429).json({ message: "Too many questions submitted. Please try again later." });
        return;
      }

      const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
      const searchQuery = typeof req.body?.searchQuery === "string" ? req.body.searchQuery.trim() : undefined;
      if (!question || question.length < 5) {
        res.status(400).json({ message: "Please describe your question in a bit more detail." });
        return;
      }
      if (question.length > MAX_QUESTION_LENGTH) {
        res.status(400).json({ message: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.` });
        return;
      }

      const account = await authStorage.getUser(userId);
      if (!account?.email) {
        res.status(400).json({ message: "Your account needs an email on file to use this." });
        return;
      }

      const appContext = typeof req.body?.appContext === "string" ? req.body.appContext.slice(0, 200) : null;

      await db.insert(kbQuestions).values({
        userId,
        question,
        searchQuery: searchQuery || null,
        appContext,
      });

      if (isEmailConfigured()) {
        const askerName = account.displayName || account.firstName || account.email;
        const html = `
          <p><strong>New Knowledge Base question</strong></p>
          <p><strong>From:</strong> ${escapeHtml(askerName)} (${escapeHtml(account.email)})</p>
          ${searchQuery ? `<p><strong>They searched for:</strong> ${escapeHtml(searchQuery)}</p>` : ""}
          <p><strong>Question:</strong></p>
          <p>${escapeHtml(question).replace(/\n/g, "<br>")}</p>
          ${appContext ? `<p style="color:#888;font-size:12px">Context: ${escapeHtml(appContext)}</p>` : ""}
          <p style="color:#888;font-size:12px">Reply to this email to answer them directly.</p>
        `;
        const text = `New Knowledge Base question\n\nFrom: ${askerName} (${account.email})\n${
          searchQuery ? `They searched for: ${searchQuery}\n` : ""
        }\nQuestion:\n${question}\n${appContext ? `\nContext: ${appContext}\n` : ""}\nReply to this email to answer them directly.`;

        await sendEmail({
          to: SUPPORT_EMAIL,
          subject: `KB question: ${question.slice(0, 60)}${question.length > 60 ? "…" : ""}`,
          html,
          text,
          replyTo: account.email,
        }).catch((err) => console.error("Failed to send KB question email to support:", err));

        await sendEmail({
          to: account.email,
          subject: "We got your question — SuperHub",
          html: `
            <p>Hi ${escapeHtml(askerName)},</p>
            <p>Thanks for reaching out! We received your question:</p>
            <p style="background:#f5f5f5;border-radius:8px;padding:12px">${escapeHtml(question).replace(/\n/g, "<br>")}</p>
            <p>We'll reply to this email as soon as we can.</p>
            <p>— SuperHub</p>
          `,
          text: `Hi ${askerName},\n\nThanks for reaching out! We received your question:\n\n${question}\n\nWe'll reply to this email as soon as we can.\n\n— SuperHub`,
        }).catch((err) => console.error("Failed to send KB confirmation email to asker:", err));
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Failed to submit KB question:", error);
      res.status(500).json({ message: "Failed to send your question. Please try again." });
    }
  });
}
