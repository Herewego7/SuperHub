import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { contrastText, EVENT_FALLBACK_COLOR, forEveryone } from "@/lib/eventColor";
import type { HomeModel } from "./useHomeDay";

const ALL_FAMILY_GRAY = "#888888";
const SHOWN = 2;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * Who an item is for, in each person's own color. Tapping hands it to someone
 * else. For an email, the pick also decides where that sender's mail goes next.
 */
export function PersonChips({ home, profileIds, title, onPick, sender }: { home: HomeModel; profileIds: string[] | null | undefined; title: string; onPick: (ids: string[]) => void; sender?: string | null }) {
  const { people, personId, familyColor } = home.props;
  const ids = profileIds ?? [];
  const everyone = forEveryone(ids, home.colorPeople);
  const assigned = people.filter((person) => ids.includes(person.id));
  const chips = everyone
    ? [{ key: "everyone", label: "Everyone", color: familyColor || ALL_FAMILY_GRAY }]
    : assigned.map((person) => ({ key: person.id, label: firstName(person.name), color: person.color || EVENT_FALLBACK_COLOR }));
  const extra = chips.length - SHOWN;
  const label = chips.length === 0
    ? `Assign ${title}`
    : `${title} is for ${everyone ? "everyone" : assigned.map((person) => person.name).join(" and ")}. Change who`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className="ml-auto flex shrink-0 items-center gap-1">
          {chips.length === 0 ? (
            <span data-testid="home-todo-chip" className="rounded-full bg-[#F1F1F4] px-2.5 py-1 text-xs font-medium text-[#6e6e78]">Assign</span>
          ) : (
            chips.slice(0, SHOWN).map((chip) => (
              <span
                key={chip.key}
                data-testid="home-todo-chip"
                className="max-w-[84px] truncate rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ backgroundColor: chip.color, color: contrastText(chip.color) }}
              >
                {chip.label}
              </span>
            ))
          )}
          {extra > 0 && <span className="rounded-full bg-[#F1F1F4] px-2 py-1 text-xs font-medium text-[#6e6e78]">+{extra}</span>}
          <ChevronDown className="h-3.5 w-3.5 text-[#a0a0a8]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[16rem]">
        <DropdownMenuLabel className="text-xs font-medium text-[#6e6e78]">Who is this for?</DropdownMenuLabel>
        {people.map((person) => {
          const only = !everyone && ids.length === 1 && ids[0] === person.id;
          return (
            <DropdownMenuItem key={person.id} data-testid="home-assign-person" onClick={() => onPick([person.id])}>
              <span className="flex-1">{person.name}{person.id === personId ? " (me)" : ""}</span>
              {only && <Check className="h-4 w-4 text-[#5E8FAD]" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
        {people.length >= 2 && (
          <DropdownMenuItem onClick={() => onPick(people.map((person) => person.id))}>
            <span className="flex-1">Everyone</span>
            {everyone && <Check className="h-4 w-4 text-[#5E8FAD]" aria-hidden="true" />}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onPick([])}>Unassigned</DropdownMenuItem>
        {sender && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-xs text-[#6e6e78]">New mail from {sender} will go to who you pick.</p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
