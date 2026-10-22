/**
 * An email's plain text, with every web address cut down to the site's name
 * (or, for a Markdown link, the words it was written on).
 * Newsletters read as walls of tracking links once the HTML is gone:
 * "(https://www.bloomberg.com/news/articles/…?_hsenc=p2ANqtz-…)" becomes a
 * tappable "(Bloomberg)" (2026-10-22).
 */
export type MailPart = { text: string } | { text: string; href: string };

/** A Markdown link, "[Register now →](https://…)", whose words are the link; or a bare address. */
const LINK_PATTERN = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|<?\bhttps?:\/\/[^\s<>"]+>?/gi;

/**
 * Newsletter clutter that only made sense in the formatted email: picture
 * placeholders ("View image: (…)", "Follow image link: (…)", an empty
 * "Caption:"), divider lines of dashes, and Markdown bold marks left as
 * stray "**" (2026-10-22).
 */
export function tidyMailText(text: string): string {
  return text
    .split("\n")
    // A line that is only dashes or underscores was a divider; a blank line does that here.
    .map((line) => (/^\s*[-_=–—]{3,}\s*$/.test(line) ? "" : line))
    .filter((line) => !/^\s*(view image|follow image link)\s*:\s*\(?\s*(https?:\/\/\S*)?\s*\)?\s*$/i.test(line) && !/^\s*caption\s*:\s*$/i.test(line))
    .join("\n")
    .replace(/\*{2,}/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
export function mailParts(raw: string): MailPart[] {
  const text = tidyMailText(raw);
  const parts: MailPart[] = [];
  let at = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    if (match[1] !== undefined) {
      if (start > at) parts.push({ text: text.slice(at, start) });
      parts.push({ text: match[1].trim() || siteName(match[2]), href: match[2] });
      at = start + match[0].length;
      continue;
    }
    let raw = match[0];
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
