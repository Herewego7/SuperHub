import { useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/colorConversion";

interface ColorSpectrumPickerProps {
  value: string;
  onChange: (hex: string) => void;
  testId?: string;
  // Renders the trigger as a small square swatch (matching the preset color
  // grid) instead of the full-width hex bar — for slotting "Custom Color" in
  // as just another option in that grid rather than its own separate section.
  compact?: boolean;
  // Compact mode only: highlight the swatch as the active selection, the
  // same way a matching preset color swatch would be (i.e. value isn't one
  // of the presets, so this custom swatch represents the current color).
  selected?: boolean;
}

// Drags a circle handle around a saturation/value square (the "Spectrum")
// plus a hue slider, using Pointer Events so the same code drags correctly
// with mouse, touch, or pen — desktop web, mobile web, and the Capacitor
// (WebView-based) iOS app all get consistent behavior. The color is only
// committed to the caller when "Select Color" is pressed, so a drag-in-
// progress never mutates the underlying form state on every frame.
export function ColorSpectrumPicker({ value, onChange, testId, compact, selected }: ColorSpectrumPickerProps) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"square" | "hue" | null>(null);

  useEffect(() => {
    if (open) setHsv(hexToHsv(value));
  }, [open, value]);

  const draftHex = hsvToHex(hsv);

  const updateFromSquare = (clientX: number, clientY: number) => {
    const el = squareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    setHsv((prev) => ({ ...prev, s: x, v: 1 - y }));
  };

  const updateFromHue = (clientX: number) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHsv((prev) => ({ ...prev, h: x * 360 }));
  };

  const onSquarePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = "square";
    updateFromSquare(e.clientX, e.clientY);
  };

  const onHuePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = "hue";
    updateFromHue(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current === "square") updateFromSquare(e.clientX, e.clientY);
    else if (draggingRef.current === "hue") updateFromHue(e.clientX);
  };

  const endDrag = () => {
    draggingRef.current = null;
  };

  const hueColor = `hsl(${hsv.h}, 100%, 50%)`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <button
            type="button"
            title="Custom color"
            className={`relative w-full h-8 rounded-md border-2 transition-all flex items-center justify-center ${
              selected ? "border-primary scale-110 shadow-sm" : "border-transparent hover:scale-105"
            }`}
            style={{ backgroundColor: value }}
            data-testid={testId}
          >
            <Palette className="w-3.5 h-3.5 text-white/90 drop-shadow-sm" />
          </button>
        ) : (
          <button
            type="button"
            className="w-full h-10 rounded border border-border cursor-pointer flex items-center gap-2 px-3"
            style={{ backgroundColor: value }}
            data-testid={testId}
          >
            <span className="text-xs font-mono text-white/90 drop-shadow-sm">{value}</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div
          ref={squareRef}
          className="relative w-full h-40 rounded-md touch-none select-none cursor-crosshair"
          style={{
            background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), ${hueColor}`,
          }}
          onPointerDown={onSquarePointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          data-testid="color-spectrum-square"
        >
          <div
            className="absolute w-5 h-5 rounded-full border-2 border-white shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              backgroundColor: draftHex,
            }}
          />
        </div>

        <div
          ref={hueRef}
          className="relative w-full h-4 rounded-full touch-none select-none cursor-pointer"
          style={{
            background:
              "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
          }}
          onPointerDown={onHuePointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          data-testid="color-spectrum-hue"
        >
          <div
            className="absolute top-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
            style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueColor }}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded border border-border"
              style={{ backgroundColor: draftHex }}
            />
            <span className="text-xs font-mono text-muted-foreground">{draftHex}</span>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onChange(draftHex);
              setOpen(false);
            }}
            data-testid="color-spectrum-confirm"
          >
            Select Color
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
