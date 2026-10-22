/**
 * An email's plain text, with every web address cut down to the site's name.
 * Newsletters read as walls of tracking links once the HTML is gone:
 * "(https://www.bloomberg.com/news/articles/…?_hsenc=p2ANqtz-…)" becomes a
 * tappable "(Bloomberg)" (2026-10-22).
 */
export type MailPart = { text: string } | { text: string; href: string };

const URL_PATTERN = /<?\bhttps?:\/\/[^\s<>"]+>?/gi;

/** Sites whose name is not just their domain with a capital letter. */
const SITE_NAMES: Record<string, string> = {
  nytimes: "NYT",
  wsj: "WSJ",
  washingtonpost: "Washington Post",
  youtube: "YouTube",
  youtu: "YouTube",
  linkedin: "LinkedIn",
  techcrunch: "TechCrunch",
  theverge: "The Verge",
  apnews: "AP News",
  foxnews: "Fox News",
  nbcnews: "NBC News",
  cbsnews: "CBS News",
  abcnews: "ABC News",
  usatoday: "USA Today",
  businessinsider: "Business Insider",
  morningbrew: "Morning Brew",
};

/** Hosts that only redirect, so their name says nothing about where the link goes. */
const REDIRECT_HOST = /^(click|clicks|link|links|email|mail|trk|track|tracking|go|t|r|url|e|l|lnk|redirect|cl|ablink|u\d*)\./i;
const SHARED_SUFFIX = /\.(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/i;

export function siteName(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "link";
  }
  if (REDIRECT_HOST.test(host)) return "link";
  const labels = host.replace(/^www\d?\./, "").split(".");
  const base = labels.length >= 3 && SHARED_SUFFIX.test(host) ? labels[labels.length - 3] : labels[labels.length - 2] ?? labels[0];
  if (!base) return "link";
  if (SITE_NAMES[base]) return SITE_NAMES[base];
  if (base.length <= 4) return base.toUpperCase();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Splits text into plain runs and links, each link labeled by its site. */
export function mailParts(text: string): MailPart[] {
  const parts: MailPart[] = [];
  let at = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    let raw = match[0];
    const start = match.index ?? 0;
    // Trailing punctuation belongs to the sentence, not the address. A ")"
    // stays only when the address itself opened one, like Wikipedia's.
    let trail = "";
    while (/[.,;:!?'")\]>]$/.test(raw)) {
      const last = raw.slice(-1);
      if (last === ")" && (raw.match(/\(/g)?.length ?? 0) >= (raw.match(/\)/g)?.length ?? 0)) break;
      trail = last + trail;
      raw = raw.slice(0, -1);
    }
    const href = raw.replace(/^</, "");
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: siteName(href), href });
    if (trail) parts.push({ text: trail.replace(/^>/, "") });
    at = start + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts.filter((part) => part.text !== "").reduce<MailPart[]>((merged, part) => {
    const last = merged[merged.length - 1];
    if (last && !("href" in last) && !("href" in part)) merged[merged.length - 1] = { text: last.text + part.text };
    else merged.push(part);
    return merged;
  }, []);
}
