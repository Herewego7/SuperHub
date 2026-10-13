import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { contrastText, EVENT_FALLBACK_COLOR, forEveryone } from "@/lib/eventColor";
import type { HomeModel } from "./useHomeDay";

const ALL_FAMILY_GRAY = "#888888";
const SHOWN = 2;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Who an item is for, in each person's own color. Tapping hands it to someone else. */
export function PersonChips({ home, profileIds, title, onPick }: { home: HomeModel; profileIds: string[] | null | undefined; title: string; onPick: (ids: string[]) => void }) {
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
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {people.map((person) => (
          <DropdownMenuItem key={person.id} onClick={() => onPick([person.id])}>
            {person.name}{person.id === personId ? " (me)" : ""}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onPick([])}>Unassigned</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
