/**
 * Kinds of email a family can say they never want as to-dos, whoever sends
 * them. Kept the same as family-hub/src/lib/mailKinds.ts.
 *
 * `always` kinds are never to-dos for anyone. A password reset or a sign-in
 * code belongs to something the person is doing that minute, and it expires.
 */
export type MailKindId = "account" | "orders" | "reviews" | "promotions" | "social" | "billing";

export type MailKind = { id: MailKindId; label: string; detail: string; always?: boolean };

export const MAIL_KINDS: readonly MailKind[] = [
  { id: "account", label: "Account & security", detail: "Password resets, sign-in codes, verify your email", always: true },
  { id: "orders", label: "Orders & deliveries", detail: "Receipts, shipping, and delivery updates", always: true },
  { id: "reviews", label: "Reviews & surveys", detail: "Rate your purchase, how did we do, feedback surveys" },
  { id: "promotions", label: "Sales & promotions", detail: "Deals, coupons, new arrivals, and offers" },
  { id: "social", label: "Social notifications", detail: "LinkedIn, Facebook, and other connection or follower updates" },
  { id: "billing", label: "Bills & subscriptions", detail: "Statements, renewals, and payment reminders" },
];

/** The prefix a stopped kind is saved under in the household's dismissed list. */
export const KIND_PREFIX = "kind:";

const SOCIAL_SENDERS = ["linkedin.com", "facebookmail.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "nextdoor.com", "pinterest.com", "tiktok.com", "snapchat.com", "reddit.com", "redditmail.com"];

const RULES: Record<MailKindId, RegExp> = {
  account: /\b(?:reset (?:your |the )?password|password reset|forgot (?:your )?password|change (?:your )?password|password (?:was |has been )?changed|verification code|security code|one[- ]time (?:code|passcode|password)|sign[- ]?in (?:code|link|attempt)|log[- ]?in (?:code|link|attempt)|magic link|verify your (?:email|account|identity)|confirm your (?:email|account)|two[- ]factor|2fa|new (?:device|sign[- ]?in|login))\b/i,
  orders: /\b(?:your order|order (?:confirmation|confirmed|#|number|received|update)|(?:has|have) shipped|out for delivery|(?:was|been|package) delivered|tracking number|receipt for|your receipt)\b/i,
  reviews: /\b(?:review (?:your|the|my) (?:purchase|order|item|items|product|stay|visit|experience)|rate (?:your|the|my|us)|leave (?:a |us a )?review|write a review|how did we do|how was your|how would you rate|tell us (?:about|what you think)|share your (?:feedback|thoughts|experience)|(?:quick|short|customer|satisfaction) survey|take (?:our|a) survey|we value your feedback)\b/i,
  promotions: /\b(?:\d+% off|% off|sale ends|flash sale|limited time|special offer|exclusive offer|shop now|new arrivals|coupon|promo code|free shipping|deal of the|black friday|cyber monday|save up to|don't miss (?:out|these))\b/i,
  social: /\b(?:invited you to connect|wants to connect|connection request|accepted your invitation|new follower|started following you|liked your|commented on your|mentioned you|tagged you|people you may know|endorsed you|viewed your profile)\b/i,
  // Saved to-dos keep the reader's own words ("Review your Wells Fargo
  // statement"), not the subject, so the wording around statements is wide.
  billing: /\b(?:(?:your|new|monthly|account|card|bank|billing|credit card|checking|savings|e-?) ?(?:bill|statement|e-?statement|invoice)s?\b[^\n.]{0,40}?\b(?:is |are |now )?(?:ready|available|posted|online)|(?:review|view|check|download|see|look over|read) (?:your |the |my |this month's |the latest )?(?:[\w&'.-]+ ){0,4}(?:bill|statement|e-?statement|invoice)s?|(?:monthly|account|credit card|card|bank|billing|checking|savings) statement|e-?statements?|statement (?:balance|period|date|closing)|pay (?:your |the |my )?(?:[\w&'.-]+ ){0,3}(?:bill|invoice|card balance|balance due)|payment (?:due|reminder|is due|scheduled)|autopay|subscription (?:renew|renewal|will renew|is renewing|ending|expir)|renews on|renewal (?:notice|reminder)|membership renewal|amount due|minimum (?:payment|due))\b/i,
};

function domainOf(address: string | null | undefined): string {
  const at = address?.lastIndexOf("@") ?? -1;
  return at >= 0 && address ? address.slice(at + 1).toLowerCase().trim() : "";
}

/**
 * Every kind an email matches, from its subject, the start of its text, and
 * who sent it. An email can be more than one kind; none means it is the
 * ordinary mail Home is for.
 */
export function mailKindsOf(mail: { subject?: string | null; text?: string | null; from?: string | null }): MailKindId[] {
  const said = `${mail.subject ?? ""}\n${(mail.text ?? "").slice(0, 600)}`;
  const domain = domainOf(mail.from);
  const kinds = (Object.keys(RULES) as MailKindId[]).filter((kind) => RULES[kind].test(said));
  if (domain && SOCIAL_SENDERS.some((item) => domain === item || domain.endsWith(`.${item}`)) && !kinds.includes("social")) kinds.push("social");
  return kinds;
}

/** The kinds a household stopped, read from its dismissed list. */
export function stoppedKinds(dismissed: readonly string[] | null | undefined): MailKindId[] {
  const known = new Set(MAIL_KINDS.map((kind) => kind.id));
  return (dismissed ?? []).flatMap((key) => {
    if (!key.startsWith(KIND_PREFIX)) return [];
    const id = key.slice(KIND_PREFIX.length) as MailKindId;
    return known.has(id) ? [id] : [];
  });
}

/** Whether mail of these kinds is kept out: an always kind, or one the family stopped. */
export function kindKeptOut(kinds: readonly MailKindId[], stopped: readonly MailKindId[]): boolean {
  return kinds.some((kind) => MAIL_KINDS.find((row) => row.id === kind)?.always || stopped.includes(kind));
}
