import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { initStrandedLayerEscape } from "@/lib/strandedLayer";

// A menu left open on iPhone froze the app: page scrolling off, every touch
// ignored, and no click from iOS to close it (2026-10-22).

export function setup(): void {
  initStrandedLayerEscape();
}

export function Component() {
  return (
    <div style={{ padding: 16 }}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button data-testid="plain-menu">More ways to add</Button></DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem>Browse built-in ideas</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu modal>
        <DropdownMenuTrigger asChild><Button data-testid="modal-menu">Modal menu</Button></DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem>Item</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>
      <div style={{ height: 2000 }} />
    </div>
  );
}
