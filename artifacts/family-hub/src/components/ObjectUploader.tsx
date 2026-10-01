import { useState, useRef, useId } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ImageCropperModal } from "./ImageCropperModal";
import { apiUrl } from "@/lib/apiBase";
import { getToken } from "@/lib/authToken";
import { downscaleImage } from "@/lib/downscaleImage";

export interface UploadResult {
  objectPath: string;
}

interface ObjectUploaderProps {
  /**
   * >1 turns on real multi-select (adds the `multiple` attribute and uploads
   * every chosen file). Stays 1 by default, and the single-file code path is
   * unchanged in that case — every existing call site relies on it.
   * Ignored when `withCrop` is set: cropping is inherently one image at a
   * time, so the two can't be combined.
   */
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onComplete?: (result: UploadResult) => void;
  /**
   * Multi-select only. Called ONCE with every successful upload, in the order
   * the files were chosen — order matters for things like recipe pages.
   * `onComplete` still fires per file if provided.
   */
  onCompleteMany?: (results: UploadResult[]) => void;
  buttonClassName?: string;
  children: ReactNode;
  accept?: string;
  withCrop?: boolean;
  /** Crop overlay shape — see ImageCropperModal. Only used with `withCrop`. */
  cropShape?: "circle" | "square";
  capture?: "user" | "environment";
  /**
   * Shrink each image to this longest-edge pixel size before uploading.
   * Off by default. Multi-image flows should set it — uploads are persisted
   * base64 in Postgres and may be re-encoded into an AI request, where
   * several full-resolution phone photos are far too large.
   */
  downscaleTo?: number;
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760,
  onComplete,
  onCompleteMany,
  buttonClassName,
  children,
  accept = "image/*",
  withCrop = false,
  cropShape = "circle",
  capture,
  downscaleTo,
}: ObjectUploaderProps) {
  const allowMultiple = maxNumberOfFiles > 1 && !withCrop;
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  /**
   * @param silent suppresses the per-file success toast and the isUploading
   *   bookkeeping — the multi-file path manages both itself so the user sees
   *   one toast and one progress indicator instead of N of each.
   * @returns the uploaded object path, or null on failure.
   */
  const uploadBlob = async (blob: Blob, filename?: string, silent = false): Promise<string | null> => {
    if (!silent) setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, filename ?? "upload");

      const token = await getToken();
      const response = await fetch(apiUrl("/api/objects/upload"), {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as any)?.error ?? "Upload failed");
      }

      const { objectPath } = await response.json();
      onComplete?.({ objectPath });
      if (!silent) {
        toast({ title: "Upload successful", description: "Your image has been uploaded successfully!" });
      }
      return objectPath as string;
    } catch (error) {
      console.error("Upload error:", error);
      if (!silent) {
        // Show the server's own reason when it gave one. "Please try again"
        // is actively wrong for an unsupported file type, where retrying can
        // never work — the person needs to know to pick a different file.
        const reason = error instanceof Error ? error.message : "";
        toast({
          title: "Upload failed",
          description: reason && reason !== "Upload failed"
            ? reason
            : "Failed to upload image. Please try again.",
          variant: "destructive",
        });
      }
      return null;
    } finally {
      if (!silent) {
        setIsUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  };

  const tooLarge = (file: File) => file.size > maxFileSize;
  const sizeToast = () =>
    toast({
      title: "File too large",
      description: `File must be smaller than ${Math.round(maxFileSize / 1024 / 1024)}MB`,
      variant: "destructive",
    });

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // ── Multi-select path ────────────────────────────────────────────────
    // Only reachable when the caller opted in via maxNumberOfFiles > 1, so
    // the single-file behavior below is untouched for every existing caller.
    if (allowMultiple) {
      const chosen = Array.from(files).slice(0, maxNumberOfFiles);
      const skipped = files.length - chosen.length;
      setIsUploading(true);
      setProgress({ done: 0, total: chosen.length });
      const uploaded: UploadResult[] = [];
      let failures = 0;
      try {
        // Sequential, not Promise.all: keeps the resulting order identical to
        // the selection order (which matters when the images are ordered
        // pages of one document) and avoids hammering the upload endpoint
        // with several large bodies at once.
        for (const file of chosen) {
          if (tooLarge(file)) { failures++; setProgress((p) => p && { ...p, done: p.done + 1 }); continue; }
          const blob = downscaleTo ? await downscaleImage(file, { maxEdge: downscaleTo }) : file;
          const objectPath = await uploadBlob(blob, file.name, true);
          if (objectPath) uploaded.push({ objectPath });
          else failures++;
          setProgress((p) => p && { ...p, done: p.done + 1 });
        }
      } finally {
        setIsUploading(false);
        setProgress(null);
        if (inputRef.current) inputRef.current.value = "";
      }

      if (uploaded.length === 0) {
        toast({
          title: "Upload failed",
          description: "None of those photos could be uploaded. Please try again.",
          variant: "destructive",
        });
        return;
      }
      if (failures > 0 || skipped > 0) {
        const parts: string[] = [];
        if (failures > 0) parts.push(`${failures} couldn't be uploaded`);
        if (skipped > 0) parts.push(`${skipped} over the ${maxNumberOfFiles}-photo limit`);
        toast({ title: `Added ${uploaded.length} photo${uploaded.length === 1 ? "" : "s"}`, description: parts.join("; ") });
      }
      onCompleteMany?.(uploaded);
      return;
    }

    // ── Single-file path (unchanged) ─────────────────────────────────────
    const file = files[0];
    if (tooLarge(file)) { sizeToast(); return; }
    if (withCrop) {
      setPendingFile(file);
    } else {
      const blob = downscaleTo ? await downscaleImage(file, { maxEdge: downscaleTo }) : file;
      await uploadBlob(blob, file.name);
    }
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    await uploadBlob(croppedBlob, "cropped.jpg");
    setPendingFile(null);
  };

  const uid = useId();
  const id = `file-upload-${uid}`;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        {...(allowMultiple ? { multiple: true } : {})}
        {...(capture ? { capture } : {})}
        onChange={handleFileSelect}
        style={{ display: "none" }}
        id={id}
        disabled={isUploading}
      />
      <label htmlFor={id} style={{ display: "contents" }}>
        <Button
          type="button"
          className={buttonClassName}
          disabled={isUploading}
          asChild
        >
          <span style={{ cursor: isUploading ? "not-allowed" : "pointer" }}>
            {isUploading
              ? progress && progress.total > 1
                ? `Uploading ${progress.done + 1} of ${progress.total}…`
                : "Uploading..."
              : children}
          </span>
        </Button>
      </label>

      {withCrop && (
        <ImageCropperModal
          file={pendingFile}
          onClose={() => {
            setPendingFile(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
          onCropComplete={handleCropComplete}
          cropShape={cropShape}
        />
      )}
    </>
  );
}
