/**
 * Shrink a photo before upload.
 *
 * Needed specifically by multi-image flows (Snap a Recipe): a modern phone
 * photo is 3–8 MB, uploaded images are persisted base64-encoded in Postgres
 * (see the `uploaded_files` table), and several of them then have to be
 * base64'd again into a single AI request. Five full-resolution photos would
 * be tens of megabytes of request body — slow at best, and over the limit at
 * worst.
 *
 * 1600px on the longest edge keeps printed/handwritten recipe text
 * comfortably legible for OCR while bringing a typical phone photo down to
 * roughly 300–800 KB.
 *
 * Fails open: if anything goes wrong (decode error, no canvas support, a
 * format the browser can't read), the ORIGINAL file is returned rather than
 * throwing, so a downscale problem can never block an upload outright.
 */

export interface DownscaleOptions {
  /** Longest-edge cap in CSS pixels. */
  maxEdge?: number;
  /** JPEG quality, 0–1. */
  quality?: number;
}

export async function downscaleImage(
  file: File,
  { maxEdge = 1600, quality = 0.85 }: DownscaleOptions = {},
): Promise<Blob> {
  try {
    // HEIC/HEIF (the iPhone default) can't be decoded by canvas in most
    // browsers. Leave those alone — the server already accepts and forwards
    // them, and a failed decode here would just return the original anyway.
    if (/image\/(heic|heif)/i.test(file.type)) return file;

    const bitmap = await loadBitmap(file);
    const { width, height } = bitmap;
    const longest = Math.max(width, height);

    // Already small enough — don't re-encode (which would only lose quality
    // and could even grow a well-compressed file).
    if (longest <= maxEdge) {
      closeBitmap(bitmap);
      return file;
    }

    const scale = maxEdge / longest;
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      closeBitmap(bitmap);
      return file;
    }
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
    closeBitmap(bitmap);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    // Only take the downscaled version if it's actually smaller.
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // imageOrientation:"from-image" applies the EXIF rotation phone photos
      // carry — without it a portrait photo can come out sideways, which
      // measurably hurts OCR.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    // Safe to revoke once decoded; the bitmap/element keeps its own data.
    URL.revokeObjectURL(url);
  }
}

function closeBitmap(b: ImageBitmap | HTMLImageElement): void {
  if (typeof ImageBitmap !== "undefined" && b instanceof ImageBitmap) b.close();
}
