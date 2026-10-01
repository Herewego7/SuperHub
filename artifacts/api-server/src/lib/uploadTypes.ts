/**
 * What may be uploaded and stored as an object.
 *
 * `multer` accepted anything up to 20 MB and `streamToResponse` echoed the
 * stored content type straight back, so an attacker could park `text/html` on
 * the origin and serve it from a URL that looks like ours. Every real use is
 * a photo or a scanned document, so an allowlist costs nothing.
 *
 * Pure so the accept/reject sets are testable without an HTTP server.
 */
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  // Flyer snap accepts a scanned menu or school newsletter — see
  // previewFromPdfObjectPath, which renders the first page server-side.
  "application/pdf",
] as const;

/**
 * ⚠️ `image/svg+xml` is deliberately NOT allowed. It is the one image type
 * that is really a document: it can carry <script>, and served from our own
 * origin that is a stored cross-site-scripting hole wearing a photo's
 * clothes. Anything that genuinely needs vector art should ship with the app.
 */
export function isAllowedUploadType(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  // Strip any parameters: browsers send things like `text/plain; charset=utf-8`.
  const base = contentType.split(";")[0].trim().toLowerCase();
  return (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(base);
}
