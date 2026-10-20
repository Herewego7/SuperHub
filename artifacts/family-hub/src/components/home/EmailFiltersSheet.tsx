import { Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MAIL_KINDS } from "@/lib/mailKinds";
import type { HomeModel } from "./useHomeDay";

/**
 * What Home skips from email, for every card at once: kinds of email from
 * any sender, and the senders someone stopped. Each tick saves as it's made.
 */
export function EmailFiltersSheet({ home }: { home: HomeModel }) {
  const { filtersOpen, setFiltersOpen, kindsOff, setKind, stoppedSenders, resumeSender } = home;
  const senders = [...new Set(stoppedSenders.map((address) => address.trim().toLowerCase()).filter(Boolean))];
  return (
    <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl" data-testid="home-email-filters">
        <SheetHeader><SheetTitle className="text-left">Email filters</SheetTitle></SheetHeader>
        <p className="mt-1 text-sm text-[#6e6e78]">What Home leaves out of To-dos, Key Dates and every other card, from all your email.</p>
        <h3 className="mt-4 text-sm font-medium">Kinds of email to skip</h3>
        <p className="mt-0.5 text-xs text-[#6e6e78]">From every sender. Open ones leave now; unticking brings back future email.</p>
        <ul className="mt-1 flex flex-col">
          {MAIL_KINDS.filter((kind) => !kind.always).map((kind) => {
            const off = kindsOff.includes(kind.id);
            return (
              <li key={kind.id} className="border-t border-[#ececf0] first:border-t-0">
                <button type="button" role="checkbox" aria-checked={off} data-testid={`home-kind-${kind.id}`} className="flex w-full items-start gap-3 py-3 text-left" onClick={() => setKind.mutate({ kind: kind.id, off: !off })}>
                  <span className={`mt-0.5 grid h-[21px] w-[21px] shrink-0 place-items-center rounded-[5px] border-[1.5px] ${off ? "border-[#5E8FAD] bg-[#5E8FAD] text-white" : "border-[#a0a0a8]"}`}>
                    {off && <Check className="h-3 w-3" />}
                  </span>
                  <span>
                    <span className="block text-[15px]">{kind.label}</span>
                    <span className="mt-0.5 block text-xs text-[#6e6e78]">{kind.detail}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <h3 className="mt-4 text-sm font-medium">Stopped senders</h3>
        {senders.length === 0 ? (
          <p className="mt-0.5 text-xs text-[#6e6e78]">None yet. Use Stop emails from an item's ⋮ menu.</p>
        ) : (
          <ul className="mt-1 flex flex-col" data-testid="home-stopped-senders">
            {senders.map((address) => (
              <li key={address} className="flex items-center justify-between gap-3 border-t border-[#ececf0] py-2.5 first:border-t-0">
                <span className="min-w-0 truncate text-sm">{address}</span>
                <button type="button" aria-label={`Undo stopping ${address}`} className="shrink-0 text-sm font-semibold text-[#5E8FAD]" onClick={() => resumeSender.mutate(address)}>Undo</button>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
