import { useState, useRef, useCallback, useEffect } from "react";
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ImageCropperModalProps {
  file: File | null;
  onClose: () => void;
  onCropComplete: (croppedBlob: Blob) => Promise<void>;
  /**
   * Shape of the crop overlay. Defaults to a circle, which is right for
   * profile photos — they render as circles everywhere. Celebration photos
   * render as squares in the gallery, so cropping them in a circle showed
   * one shape and produced another.
   */
  cropShape?: "circle" | "square";
}

function centerAspectCrop(mediaWidth: number, mediaHeight: number, aspect: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 80 }, aspect, mediaWidth, mediaHeight),
    mediaWidth,
    mediaHeight,
  );
}

export function ImageCropperModal({ file, onClose, onCropComplete, cropShape = "circle" }: ImageCropperModalProps) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [imgSrc, setImgSrc] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
    const initialCrop = centerAspectCrop(width, height, 1);
    setCrop(initialCrop);
  }, []);

  // Re-reads whenever `file` changes to a new File object — the previous
  // `if (file && !imgSrc)` guard only ever read the FIRST file selected in
  // this modal's lifetime; once imgSrc was set once, it never got cleared,
  // so picking a second photo kept showing the first one's already-loaded
  // preview instead of loading the new selection.
  useEffect(() => {
    if (!file) {
      setImgSrc("");
      setCrop(undefined);
      setCompletedCrop(undefined);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImgSrc(reader.result as string);
    reader.readAsDataURL(file);
  }, [file]);

  const getCroppedBlob = useCallback(async (): Promise<Blob | null> => {
    if (!completedCrop || !imgRef.current) return null;
    const image = imgRef.current;
    const canvas = document.createElement("canvas");
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    const outputSize = 512;
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      image,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      outputSize,
      outputSize,
    );
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas is empty"));
      }, "image/jpeg", 0.9);
    });
  }, [completedCrop]);

  const handleCropAndUpload = async () => {
    const blob = await getCroppedBlob();
    if (!blob) return;
    setIsUploading(true);
    try {
      await onCropComplete(blob);
      onClose();
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={() => !isUploading && onClose()}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle>Crop Photo</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground text-center">
            Drag to reposition and resize the crop area. The photo will be cropped to a square.
          </p>
          {imgSrc && (
            <div className="w-full max-h-[60vh] overflow-auto flex items-center justify-center bg-muted/30 rounded-lg p-2">
              <ReactCrop
                crop={crop}
                onChange={(_, percentCrop) => setCrop(percentCrop)}
                onComplete={(c) => setCompletedCrop(c)}
                aspect={1}
                circularCrop={cropShape === "circle"}
                minWidth={40}
                minHeight={40}
              >
                <img
                  ref={imgRef}
                  src={imgSrc}
                  alt="Crop preview"
                  style={{ maxHeight: "55vh", maxWidth: "100%", objectFit: "contain" }}
                  onLoad={onImageLoad}
                />
              </ReactCrop>
            </div>
          )}
          {!imgSrc && (
            <div className="w-full h-48 bg-muted rounded-lg flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            onClick={handleCropAndUpload}
            disabled={!completedCrop || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              "Crop & Upload"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
