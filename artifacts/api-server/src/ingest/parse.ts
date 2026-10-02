/** Adapted from Bot Life functions/src/sync/gmail/parse.ts. Gmail shapes only. No Firestore. */

export function normalizeAddress(address: string): string {
  const m = /<([^>]+)>/.exec(address);
  return (m?.[1] ?? address).trim().toLowerCase();
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

export function header(msg: GmailMessage | GmailPart | undefined, name: string): string | undefined {
  const headers = (msg && "payload" in msg ? msg.payload?.headers : (msg as GmailPart | undefined)?.headers) ?? [];
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

export interface Address {
  name?: string;
  address: string;
}

export function parseAddressList(value: string | undefined): Address[] {
  if (!value) return [];
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "<") angle++;
    if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if (ch === "," && !quoted && angle === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => parseAddress(p)).filter((a): a is Address => a !== undefined);
}

export function parseAddress(value: string | undefined): Address | undefined {
  if (!value?.trim()) return undefined;
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(value);
  if (m) {
    const name = m[1]?.trim();
    return { address: normalizeAddress(m[2] ?? ""), ...(name ? { name } : {}) };
  }
  const bare = value.trim();
  return bare.includes("@") ? { address: normalizeAddress(bare) } : undefined;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export interface InboundMessage {
  subject: string;
  fromAddress?: string;
  snippet: string;
  body?: string;
  accountId: string;
}

export function decodeBody(part: GmailPart): string {
  const data = part.body?.data;
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

export function messageText(payload: GmailPart | undefined): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: GmailPart) => {
    if (part.mimeType === "text/plain") plain.push(decodeBody(part));
    else if (part.mimeType === "text/html") html.push(decodeBody(part));
    for (const child of part.parts ?? []) walk(child);
  };
  if (payload) walk(payload);
  const text = plain.join("\n").trim() || (html.length ? htmlToText(html.join("\n")).text : "");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

export function outlookToInbound(
  row: {
    subject?: string | null;
    bodyPreview?: string | null;
    body?: { content?: string | null; contentType?: string | null } | null;
    from?: { emailAddress?: { address?: string | null } | null } | null;
  },
  accountId: string,
): InboundMessage {
  const address = row.from?.emailAddress?.address?.trim();
  const raw = row.body?.content?.trim() ?? "";
  const text = !raw ? "" : row.body?.contentType === "text" ? raw : htmlToText(raw).text;
  const body = decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, 4000);
  const snippet = decodeEntities(row.bodyPreview ?? "").trim() || body.slice(0, 240);
  return {
    accountId,
    subject: row.subject?.trim() ?? "",
    snippet,
    ...(body ? { body } : {}),
    ...(address ? { fromAddress: normalizeAddress(address) } : {}),
  };
}

export function toInbound(msg: GmailMessage, accountId: string): InboundMessage {
  const from = parseAddress(header(msg, "From"));
  const body = messageText(msg.payload).slice(0, 4000);
  const snippet = decodeEntities(msg.snippet ?? "").trim() || body.slice(0, 240);
  return {
    accountId,
    ...(from ? { fromAddress: from.address } : {}),
    subject: header(msg, "Subject") ?? "",
    snippet,
    ...(body ? { body } : {}),
  };
}

function htmlToText(html: string): { text: string; links: string[] } {
  const links = [...html.matchAll(/href="(https?:[^"]+)"/gi)].map((m) => m[1] ?? "");
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { text, links };
}

export function slipKey(subject: string): string {
  return subject.toLowerCase().replace(/^(re|fwd):\s*/i, "").replace(/\s+/g, " ").trim();
}
