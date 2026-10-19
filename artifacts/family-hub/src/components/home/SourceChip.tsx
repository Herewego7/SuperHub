import { Mail } from "lucide-react";
import { sourceShortLabel } from "@/lib/homeDay";

/**
 * Where an item came from, in the space a chip has: a mail icon and the
 * sender's name or site. "Source: messages-noreply@linkedin.com" never fit;
 * the full address stays in the item's details.
 */
export function SourceChip({ address, name, kind }: { address: string | null; name: string | null; kind: "mail" | "todo" }) {
  const label = sourceShortLabel(address, name, kind);
  return (
    <span
      data-testid="home-todo-source"
      title={address ?? undefined}
      aria-label={address ? `From ${label}, ${address}` : label}
      className="inline-flex min-w-0 max-w-[55%] items-center gap-1 rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs text-[#1e1e24]/80"
    >
      {kind === "mail" && <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />}
      <span className="truncate">{label}</span>
    </span>
  );
}
