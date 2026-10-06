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

export const MAX_BODY_CHARS = 60_000;
export const MAX_THREAD_MESSAGES = 5;
export const MAX_THREAD_CHARS = 4_000;
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const MEDIA_TYPES = /^(image\/(png|jpe?g|gif|webp|heic|heif)|application\/pdf)$/i;

export interface MailFile {
  mimeType: string;
  data: string;
  filename: string;
  text?: string;
}

export interface InboundMessage {
  subject: string;
  fromAddress?: string;
  snippet: string;
  body?: string;
  accountId: string;
  /** Earlier messages in the thread, or text pulled from an attachment. */
  extra?: string;
  /** Up to five earlier messages, newest last. */
  thread?: string[];
  /** Pictures and PDFs. The model sees the file and any transcribed text. */
  files?: MailFile[];
  /** The first file, kept so a one-file caller still works. */
  file?: { mimeType: string; data: string };
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
  return decodeEntities(text).replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
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
  const body = stripQuotedReply(decodeEntities(text).replace(/\r\n/g, "\n").trim()).slice(0, MAX_BODY_CHARS);
  const snippet = decodeEntities(row.bodyPreview ?? "").trim() || body.slice(0, 240);
  return {
    accountId,
    subject: row.subject?.trim() ?? "",
    snippet,
    ...(body ? { body } : {}),
    ...(address ? { fromAddress: normalizeAddress(address) } : {}),
  };
}

export const INBOX_SCAN_LIMIT = 100;
/** The regular check. The first catch-up is the last 30 days, same as Bot Life's mail backfill. */
export const INBOX_RECENT_DAYS = 2;
export const INBOX_INITIAL_DAYS = 30;
export const INBOX_INITIAL_LIMIT = 500;
/** Newsletters only, after the 30-day mail catch-up, same as Bot Life. */
export const INBOX_NEWSLETTER_DAYS = 60;
export const INBOX_NEWSLETTER_LIMIT = 200;

/** All Mail, same as Bot Life, so school mail a filter or an archive moved out of the inbox is still read. */
export function gmailInboxQuery(days: number): string {
  return `newer_than:${days}d -in:chats -in:spam -in:trash -in:sent -in:drafts`;
}

/** The month of mail before the catch-up, limited to newsletter-shaped messages. */
export function gmailNewsletterQuery(): string {
  return `newer_than:${INBOX_NEWSLETTER_DAYS}d older_than:${INBOX_INITIAL_DAYS}d (unsubscribe OR category:updates OR category:forums) -in:chats -in:spam -in:trash`;
}

/** Gmail lists newest first, so the first letter from each sender is the latest issue. */
export function latestPerSender<T extends { fromAddress?: string; subject: string }>(messages: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const message of messages) {
    const key = (message.fromAddress || message.subject).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(message);
  }
  return out;
}

export function inboxSinceIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function inboxFetchLimit(days: number): number {
  return days > INBOX_RECENT_DAYS ? INBOX_INITIAL_LIMIT : INBOX_SCAN_LIMIT;
}

/** Keep the body parts Gmail returns. The scan used to pass headers only, so a time in the body was never read. */
export function gmailPayload(part: {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; attachmentId?: string | null; size?: number | null } | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  parts?: unknown[] | null;
} | null | undefined): GmailPart | undefined {
  if (!part) return undefined;
  const headers = (part.headers ?? []).flatMap((header) =>
    header.name && header.value ? [{ name: header.name, value: header.value }] : [],
  );
  const parts = (part.parts ?? []).flatMap((child) => {
    const mapped = gmailPayload(child as Parameters<typeof gmailPayload>[0]);
    return mapped ? [mapped] : [];
  });
  return {
    mimeType: part.mimeType ?? "text/plain",
    ...(part.filename ? { filename: part.filename } : {}),
    ...(headers.length ? { headers } : {}),
    ...((part.body?.data || part.body?.attachmentId) ? { body: { ...(part.body.data ? { data: part.body.data } : {}), ...(part.body.attachmentId ? { attachmentId: part.body.attachmentId } : {}), ...(typeof part.body.size === "number" ? { size: part.body.size } : {}) } } : {}),
    ...(parts.length ? { parts } : {}),
  };
}

const OUTLOOK_FILE = "#microsoft.graph.fileAttachment";

/** Pictures and PDFs from an Outlook message. A real file wins over a logo pasted in the body. */
export function outlookAttachments(rows: unknown[]): { id: string; mimeType: string; filename: string; data?: string }[] {
  const files = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const file = row as { id?: unknown; name?: unknown; contentType?: unknown; contentBytes?: unknown; size?: unknown; isInline?: unknown; "@odata.type"?: unknown };
    const type = typeof file["@odata.type"] === "string" ? file["@odata.type"] : OUTLOOK_FILE;
    const mime = typeof file.contentType === "string" ? file.contentType.toLowerCase() : "";
    const id = typeof file.id === "string" ? file.id : "";
    const size = typeof file.size === "number" ? file.size : 0;
    if (type !== OUTLOOK_FILE || !id || !MEDIA_TYPES.test(mime) || size > MAX_MEDIA_BYTES) return [];
    const bytes = typeof file.contentBytes === "string" ? file.contentBytes : "";
    const data = bytes && base64Bytes(bytes) <= MAX_MEDIA_BYTES ? bytes : undefined;
    return [{
      id,
      mimeType: mime,
      filename: typeof file.name === "string" && file.name.trim() ? file.name.trim() : "file",
      inline: file.isInline === true,
      ...(data ? { data } : {}),
    }];
  }).sort((a, b) => Number(a.inline) - Number(b.inline));
  return files.slice(0, MAX_ATTACHMENTS).map(({ id, mimeType, filename, data }) => ({ id, mimeType, filename, ...(data ? { data } : {}) }));
}

/** One picture or PDF from an Outlook message. A real attachment wins over a logo pasted in the body. */
export function outlookAttachment(rows: unknown[]): { id: string; mimeType: string; data?: string } | null {
  const picked = outlookAttachments(rows)[0];
  if (!picked) return null;
  return { id: picked.id, mimeType: picked.mimeType, ...(picked.data ? { data: picked.data } : {}) };
}

export function fileParts(part: GmailPart | undefined): { mimeType: string; filename: string; data?: string; attachmentId?: string }[] {
  const out: { mimeType: string; filename: string; data?: string; attachmentId?: string }[] = [];
  const walk = (node: GmailPart | undefined) => {
    if (!node || out.length >= MAX_ATTACHMENTS) return;
    const mime = (node.mimeType || "").toLowerCase();
    const size = node.body?.size ?? (node.body?.data ? base64Bytes(node.body.data) : 0);
    if (MEDIA_TYPES.test(mime) && (node.body?.data || node.body?.attachmentId) && size <= MAX_MEDIA_BYTES) {
      out.push({
        mimeType: mime,
        filename: node.filename || "file",
        ...(node.body?.data ? { data: node.body.data } : {}),
        ...(node.body?.attachmentId ? { attachmentId: node.body.attachmentId } : {}),
      });
    }
    for (const child of node.parts ?? []) walk(child);
  };
  walk(part);
  return out;
}

export function toInbound(msg: GmailMessage, accountId: string): InboundMessage {
  const from = parseAddress(header(msg, "From"));
  const body = stripQuotedReply(messageText(msg.payload)).slice(0, MAX_BODY_CHARS);
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

function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

const REPLY_HEADER = [
  /^On .{4,200}(wrote|écrit|schrieb|escribió):\s*$/im,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^_{5,}\s*$\n^From: /im,
  /^From: .+\n(Sent|Date): .+\n(To|Subject): /im,
];

/** Drops the quoted earlier message from a reply. The thread carries it on its own. */
export function stripQuotedReply(text: string): string {
  let cut = text.length;
  for (const pattern of REPLY_HEADER) {
    const match = pattern.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  const lines = text.slice(0, cut).split("\n");
  while (lines.length && (/^\s*>/.test(lines[lines.length - 1] ?? "") || !(lines[lines.length - 1] ?? "").trim())) lines.pop();
  return lines.join("\n").trim();
}

/** Up to five earlier messages, oldest first, each capped so one reply cannot crowd out the letter. */
export function threadLines(
  rows: { id?: string; internalDate?: string; from?: string; text?: string }[],
  currentId: string,
  currentDate: number,
): string[] {
  return rows
    .filter((row) => row.id !== currentId && Number(row.internalDate ?? 0) < (currentDate || Number.MAX_SAFE_INTEGER))
    .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0))
    .slice(-MAX_THREAD_MESSAGES)
    .map((row) => `From: ${row.from ?? ""}\n${stripQuotedReply(row.text ?? "").slice(0, MAX_THREAD_CHARS)}`)
    .filter((line) => line.replace(/^From:\s*/, "").trim().length > 0);
}

export function attachFiles(message: InboundMessage, files: { mimeType: string; data: string; filename?: string }[]): void {
  const kept = files
    .filter((file) => file.data && base64Bytes(file.data) <= MAX_MEDIA_BYTES)
    .slice(0, MAX_ATTACHMENTS)
    .map((file) => ({
      mimeType: file.mimeType.toLowerCase(),
      data: file.data,
      filename: file.filename?.trim() || "file",
    }));
  if (kept.length === 0) return;
  message.files = kept;
  message.file = { mimeType: kept[0].mimeType, data: kept[0].data };
}

export function slipKey(subject: string): string {
  return subject.toLowerCase().replace(/^(re|fwd):\s*/i, "").replace(/\s+/g, " ").trim();
}
