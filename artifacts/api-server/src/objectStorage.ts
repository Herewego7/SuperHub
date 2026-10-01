import { db, uploadedFiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Response } from "express";
import { randomUUID } from "crypto";
import { shouldDeleteOldPhoto } from "./lib/photoCleanup";
import { isAllowedUploadType } from "./lib/uploadTypes";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  private extractId(objectNameOrPath: string): string {
    const parts = objectNameOrPath.split("/");
    return parts[parts.length - 1];
  }

  getPrivateObjectDir(): string {
    return process.env.PRIVATE_OBJECT_DIR || "/.private";
  }

  generateUploadTarget(): { objectName: string; objectPath: string } {
    const id = randomUUID();
    return {
      objectName: `.private/uploads/${id}`,
      objectPath: `/objects/uploads/${id}`,
    };
  }

  async uploadFile(
    objectName: string,
    buffer: Buffer,
    contentType = "application/octet-stream",
    userId?: string,
  ): Promise<void> {
    const id = this.extractId(objectName);
    const data = buffer.toString("base64");
    await db.insert(uploadedFiles).values({ id, contentType, data, userId });
  }

  /**
   * Who owns an uploaded object, or null when the row has no owner.
   *
   * A NULL owner means the row predates ownership being recorded (every
   * upload before 2026-09-19 stored `undefined` because the route read
   * `req.user?.id`, which does not exist on this codebase's auth shape).
   * `scripts/backfill-upload-owners.sql` recovers those; until it has been
   * run, callers treat NULL as "unknown" rather than "forbidden", or every
   * existing photo would disappear.
   */
  async getObjectOwner(objectPath: string): Promise<{ exists: boolean; userId: string | null }> {
    const id = this.extractId(objectPath.split("?")[0]);
    const [file] = await db
      .select({ userId: uploadedFiles.userId })
      .from(uploadedFiles)
      .where(eq(uploadedFiles.id, id));
    if (!file) return { exists: false, userId: null };
    return { exists: true, userId: file.userId ?? null };
  }

  async downloadBytes(objectPath: string): Promise<Buffer> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const id = this.extractId(objectPath);
    const [file] = await db
      .select()
      .from(uploadedFiles)
      .where(eq(uploadedFiles.id, id));
    if (!file) throw new ObjectNotFoundError();
    return Buffer.from(file.data, "base64");
  }

  async streamToResponse(objectPath: string, res: Response): Promise<void> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const id = this.extractId(objectPath);
    const [file] = await db
      .select()
      .from(uploadedFiles)
      .where(eq(uploadedFiles.id, id));
    if (!file) throw new ObjectNotFoundError();
    // Anything stored before the upload allowlist existed could be any type
    // at all, so the type is re-checked on the way OUT as well as in. An
    // unexpected type is served as a plain download rather than rendered,
    // which neutralises a stored text/html without hiding the file.
    const safeType = isAllowedUploadType(file.contentType)
      ? file.contentType
      : "application/octet-stream";
    res.set("Content-Type", safeType);
    // Stops the browser second-guessing the declared type — the other half of
    // the same problem, and worth having even for types we do allow.
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(file.data, "base64"));
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath) return rawPath;
    if (rawPath.startsWith("/objects/")) return rawPath;

    if (rawPath.startsWith("https://storage.googleapis.com/")) {
      try {
        const url = new URL(rawPath);
        const parts = url.pathname.split("/").filter((p) => p.length > 0);
        const uploadsIndex = parts.indexOf("uploads");
        if (uploadsIndex !== -1 && uploadsIndex < parts.length - 1) {
          const entityId = parts.slice(uploadsIndex + 1).join("/");
          return `/objects/uploads/${entityId}`;
        }
      } catch {
        // fall through
      }
    }

    return rawPath;
  }

  async deleteObjectByPath(objectPath: string): Promise<boolean> {
    try {
      if (!objectPath || !objectPath.startsWith("/objects/")) return false;
      const id = this.extractId(objectPath);
      await db.delete(uploadedFiles).where(eq(uploadedFiles.id, id));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Fire-and-forget cleanup for a photo field that just got replaced or
 * cleared — deletes the OLD uploaded_files row so it doesn't sit around
 * forever growing storage. Every upload is base64 in Postgres (no real
 * object-storage bucket), so an orphaned row is pure wasted DB storage, not
 * just an unreferenced file. Safe to call unconditionally: no-ops when
 * there's nothing to clean up (same value, no old value, or a non-/objects/
 * path like a built-in image URL).
 */
export function cleanupReplacedPhoto(oldPath: string | null | undefined, newPath: string | null | undefined): void {
  if (!shouldDeleteOldPhoto(oldPath, newPath)) return;
  new ObjectStorageService().deleteObjectByPath(oldPath as string).catch(() => false);
}
