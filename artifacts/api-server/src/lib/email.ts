// Minimal transactional-email sender using Resend's HTTP API directly (a
// plain fetch call — no SDK dependency needed for a single endpoint).
//
// Required env vars:
//   RESEND_API_KEY  — from resend.com/api-keys
//   EMAIL_FROM      — verified sender, e.g. "SuperHub <noreply@example.com>"
//                      (falls back to Resend's onboarding@resend.dev sandbox
//                      address if unset, which only delivers to the account
//                      owner's own verified email — fine for initial testing,
//                      but a real "from" domain must be verified in Resend
//                      before this can email real users)
const RESEND_API_URL = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Sets the Reply-To header — e.g. so replying to a forwarded user
      question goes straight to that user's own address. */
  replyTo?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Don't throw in production — a misconfigured email provider shouldn't
    // 500 the forgot-password endpoint and reveal (via a different response)
    // whether the account exists. Log loudly so it's caught in monitoring.
    console.error(
      "[email] RESEND_API_KEY is not set — email NOT sent. Configure it to enable password-reset emails.",
    );
    return;
  }
  const from = process.env.EMAIL_FROM || "SuperHub <onboarding@resend.dev>";

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[email] Resend API error ${res.status}: ${body}`);
    throw new Error("Failed to send email");
  }
}
