import { useState, useEffect } from "react";
import { X, Lock, Upload, Check, Image as ImageIcon, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useToast } from "@/hooks/use-toast";
import { orientedImageUrl } from "@/lib/backgroundImage";
import { useSignedObjectUrl, bareObjectPath, forgetSignedObjectUrl } from "@/lib/signedObjectUrl";
import { useIsPortrait } from "@/hooks/use-orientation";

// ── Curated built-in images ────────────────────────────────────────────────────
// The library, the stored choice and the display rules live in
// lib/backgrounds.ts — that is data, shared with the screensaver and with unit
// tests, and importing it from this component dragged React and a stylesheet
// into Node's test runner. Re-exported so existing imports keep working.
export { BUILTIN_IMAGES, PRIVACY_IMAGE_KEY, getPrivacyImageUrl, displayBackgroundUrl } from "@/lib/backgrounds";
import { BUILTIN_IMAGES, PRIVACY_IMAGE_KEY, getPrivacyImageUrl, displayBackgroundUrl } from "@/lib/backgrounds";

const STORAGE_KEY = PRIVACY_IMAGE_KEY;
const CATEGORIES = Array.from(new Set(BUILTIN_IMAGES.map(i => i.category)));

// Offline, every picture fails; stop after a few rather than walking the whole
// library, and show the clock and message instead.
const MAX_FALLBACKS = 3;

function getStoredUrl(): string {
  return getPrivacyImageUrl();
}

// ── Privacy screen overlay ─────────────────────────────────────────────────────
interface PrivacyScreenProps {
  visible: boolean;
  onDismiss: () => void;
}

export function PrivacyScreen({ visible, onDismiss }: PrivacyScreenProps) {
  const [stored, setStored] = useState(getStoredUrl);
  // Same picture, cropped to the shape of the screen showing it. Only the
  // DISPLAY url changes — what's saved stays exactly as the family chose it,
  // so nothing needs migrating and a rotation just re-requests the other crop.
  const portrait = useIsPortrait();
  // An uploaded background lives in this device's localStorage as a bare
  // path, so unlike everything that comes from the API it carries no
  // signature. Sign it here, at render — what is stored stays bare, so a
  // week-old entry keeps working.
  // If the chosen picture won't load, quietly try the next few in the library
  // before giving up. On 2026-09-30 a switch of account cleared the chosen
  // picture, the default one failed, and the screen opened on an error even
  // though every other picture loaded fine.
  const [fallbackStep, setFallbackStep] = useState(0);
  const shown = fallbackStep === 0
    ? stored
    : BUILTIN_IMAGES.filter(i => i.url !== stored)[fallbackStep - 1]?.url ?? stored;
  const imageUrl = useSignedObjectUrl(displayBackgroundUrl(shown, portrait));
  const [showPicker, setShowPicker] = useState(false);
  // Every background — including the default — is a remote Unsplash URL, and
  // a CSS background-image has no onError. So with no network (or a photo
  // that's since been removed) this screen was a featureless black rectangle:
  // no message, no clock, no way to tell it apart from a dead display. Probe
  // the URL with a real Image() so we can fall back to something legible.
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setImageFailed(false);
    // null while an uploaded background's signature is still being fetched.
    // Probing an empty src would fire onerror immediately and wrongly mark a
    // perfectly good image as failed, so wait for it.
    if (!imageUrl) return;
    const img = new Image();
    img.onerror = () => {
      if (fallbackStep < MAX_FALLBACKS) setFallbackStep(s => s + 1);
      else setImageFailed(true);
    };
    img.src = imageUrl;
    return () => { img.onerror = null; };
  }, [visible, imageUrl, fallbackStep]);

  // A new choice (or a new showing) starts from the chosen picture again.
  useEffect(() => { setFallbackStep(0); }, [stored, visible]);

  const now = new Date();

  // Keep in sync if changed elsewhere (settings)
  useEffect(() => {
    const onStorage = () => setStored(getStoredUrl());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!visible) return null;

  return (
    <>
      {/* Full-screen privacy overlay */}
      <div
        className="fixed inset-0 z-[999] select-none bg-neutral-900"
        style={{
          // The solid bg-neutral-900 above is the fallback if imageUrl ever
          // fails to load (a saved photo that later goes dead on Unsplash's
          // end) — a CSS background-image failure has no equivalent to an
          // <img>'s onError, so without a solid color underneath, a dead
          // image would leave this screen transparent and show the app
          // underneath, defeating the entire point of a PRIVACY screen.
          // Omitted entirely while null (an uploaded background still being
          // signed) rather than emitting `url(null)`, which the browser
          // treats as a load failure and logs.
          backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
        data-testid="privacy-screen"
      >
        {/* Fallback content when the remote background can't load — the whole
            point of a privacy screen is to show something, so a blank black
            rectangle is a failure state, not an acceptable default. */}
        {imageFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/90 px-8 text-center">
            <p className="text-6xl font-semibold tabular-nums tracking-tight">
              {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </p>
            <p className="text-base text-white/70 mt-2">
              {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <p className="text-sm text-white/50 mt-8 max-w-xs">
              Background image couldn't load — you may be offline. Tap “Change image” to pick another.
            </p>
          </div>
        )}

        {/* Subtle gradient veil at bottom for buttons */}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />

        {/* Controls */}
        <div className="absolute bottom-6 inset-x-0 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white text-sm font-medium hover:bg-white/30 transition-colors shadow-lg"
            data-testid="privacy-change-image"
          >
            <ImageIcon className="w-4 h-4" />
            Change image
          </button>
          <button
            type="button"
            onClick={onDismiss}
            // The exit action gets primary weight; "Change image" stays
            // secondary. They used to be identical pills, so nothing said
            // which one left the privacy screen. The icon is a plain Eye now
            // — a slashed eye reads as "hide", the opposite of what this does.
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-white text-neutral-900 text-sm font-semibold hover:bg-white/90 transition-colors shadow-lg"
            data-testid="privacy-dismiss"
          >
            <Eye className="w-4 h-4" />
            Show app
          </button>
        </div>
      </div>

      {/* Image picker dialog */}
      {showPicker && (
        // The STORED url, not the oriented one: the picker marks the current
        // choice by comparing against BUILTIN_IMAGES' own urls, which are the
        // landscape form. A portrait-cropped url would match nothing and
        // silently drop the tick.
        <PrivacyImagePicker
          currentUrl={stored}
          onSelect={(url) => {
            localStorage.setItem(STORAGE_KEY, url);
            setStored(url);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  );
}

// ── Image picker dialog ────────────────────────────────────────────────────────
interface PickerProps {
  currentUrl: string;
  onSelect: (url: string) => void;
  onClose: () => void;
}

function PrivacyImagePicker({ currentUrl, onSelect, onClose }: PickerProps) {
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [preview, setPreview] = useState<string | null>(null);
  // Unsplash occasionally retires a photo ID (the photographer removes it,
  // etc.) — when that happens the thumbnail's own <img> fails to load and
  // previously just showed a broken-image "?" icon in the grid. Any id that
  // fails is tracked here and filtered out below, so a stale entry quietly
  // disappears instead of looking broken — this self-heals the picker for
  // whichever specific ids happen to be dead right now, and for any that go
  // stale later, without needing this list hand-maintained against Unsplash.
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  const displayed = (activeCategory === "All"
    ? BUILTIN_IMAGES
    : BUILTIN_IMAGES.filter(img => img.category === activeCategory)
  ).filter(img => !failedIds.has(img.id));

  const handleUpload = (result: { objectPath: string }) => {
    if (!result.objectPath) {
      toast({ title: "Upload failed", variant: "destructive" });
      return;
    }
    // Persist the BARE path. The upload response also carries `signedUrl`
    // for immediate display, but storing that would bake in an expiry and
    // leave a permanently broken background a week later.
    const raw = result.objectPath.startsWith("/objects/")
      ? result.objectPath
      : `/objects/${result.objectPath}`;
    const url = bareObjectPath(raw);
    forgetSignedObjectUrl(url);
    localStorage.setItem(STORAGE_KEY, url);
    onSelect(url);
    toast({ title: "Privacy image updated" });
  };

  // Render as its own fixed panel above z-[999] so it isn't blocked by the
  // privacy overlay. Dialog portals use z-50 which would render behind it.
  return (
    <>
      {/* Backdrop — matches the standard Dialog overlay's bg-black/80 (was /60,
          which in dark mode was barely distinguishable from the panel's own
          dark `bg-card`, making the panel hard to make out against it). */}
      <div
        className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-x-4 top-[5vh] bottom-[5vh] z-[1001] max-w-2xl mx-auto flex flex-col bg-card rounded-2xl border border-border ring-1 ring-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-border flex-shrink-0 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Lock className="w-4 h-4 text-primary" />
              Privacy Screen Image
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose a beautiful image to hide your screen. Tap any image to preview it, then select it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-accent text-muted-foreground transition-colors ml-3 flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Upload your own */}
        <div className="px-5 py-3 border-b border-border flex-shrink-0 bg-muted/30">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Upload your own photo</p>
          <ObjectUploader
            accept="image/*"
            maxFileSize={12 * 1024 * 1024}
            downscaleTo={1600}
            onComplete={handleUpload}
            buttonClassName="h-9 px-4 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Choose photo
          </ObjectUploader>
        </div>

        {/* Category filter */}
        <div
          className="px-5 py-2.5 border-b border-border flex gap-1.5 overflow-x-auto flex-shrink-0 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {["All", ...CATEGORIES].map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`text-xs px-3 py-1.5 rounded-full border flex-shrink-0 transition-colors font-medium ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Image grid */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {displayed.map(img => {
              const isSelected = currentUrl === img.url;
              const isPreviewing = preview === img.url;
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => {
                    if (isPreviewing) {
                      onSelect(img.url);
                    } else {
                      setPreview(img.url);
                    }
                  }}
                  className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all group ${
                    isSelected
                      ? "border-primary shadow-md"
                      : isPreviewing
                      ? "border-primary/60 shadow-sm"
                      : "border-transparent hover:border-primary/30"
                  }`}
                  title={img.label}
                  data-testid={`privacy-img-${img.id}`}
                >
                  <img
                    src={img.url.replace("w=1920&h=1080", "w=400&h=225")}
                    alt={img.label}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={() => setFailedIds(prev => new Set(prev).add(img.id))}
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[9px] text-white font-medium truncate">{img.label}</p>
                  </div>
                  {isSelected && (
                    <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  )}
                  {isPreviewing && !isSelected && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <span className="text-[10px] bg-black/60 text-white px-2 py-1 rounded-full font-medium">Tap to select</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Preview strip */}
        {preview && (
          <div className="flex-shrink-0 border-t border-border">
            <div className="relative h-28 overflow-hidden">
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onSelect(preview)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-full text-sm font-semibold shadow-lg hover:bg-primary/90 transition-colors"
                >
                  Use this image
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="px-4 py-2 bg-white/20 backdrop-blur text-white rounded-full text-sm font-medium border border-white/30 hover:bg-white/30 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-border flex-shrink-0 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </>
  );
}
