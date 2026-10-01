import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";

// Regression coverage for the 2026-08-27 "swipe up to dismiss a toast"
// feature — a minimal page that fires a real toast via the app's own
// `toast()` helper and the real <Toaster/>, so a test can drag the actual
// rendered toast element exactly like a user would.

export function setup(): void {}

export function Component() {
  return (
    <div style={{ padding: 16 }}>
      <Button
        onClick={() =>
          toast({ title: "Saved", description: "Your changes were saved." })
        }
      >
        Show toast
      </Button>
      <Toaster />
    </div>
  );
}
