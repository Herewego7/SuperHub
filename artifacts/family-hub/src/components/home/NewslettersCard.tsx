import { useState } from "react";
import { ChevronRight, EyeOff, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { issueDateLabel, newsletterInitials, PLAN_NEWSLETTERS } from "@/lib/homeDay";
import { noteBullets } from "@/lib/slipMail";
import { HomeCard } from "./HomeCard";
import { PersonChips } from "./PersonChips";
import type { HomeModel, Letters } from "./useHomeDay";

const LOGO_INKS = ["#2F5E9E", "#C0392B", "#2E7355", "#5E8FAD", "#9A4E2A"];

function logoInk(text: string): string {
  const sum = [...text].reduce((total, char) => total + char.charCodeAt(0), 0);
  return LOGO_INKS[sum % LOGO_INKS.length];
}

export function NewslettersCard({ home }: { home: HomeModel }) {
  const { newsletters, visibleNewsletters, showAllLetters, setShowAllLetters } = home;
  const summary = newsletters.length === 0 ? "None yet" : newsletters.length === 1 ? "1 newsletter" : `${newsletters.length} newsletters`;
  return (
    <HomeCard id="newsletters" title="Newsletters" summary={summary} collapsed={home.isCollapsed("newsletters")} onToggle={() => home.toggleCard("newsletters")}>
      {visibleNewsletters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No newsletters in the last 30 days.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleNewsletters.map((letters) => <NewsletterRow key={letters.key} home={home} letters={letters} />)}
        </ul>
      )}
      {newsletters.length > PLAN_NEWSLETTERS && !showAllLetters && (
        <button type="button" className="mt-2 w-full rounded-full bg-[#F1F1F4] py-2 text-sm font-medium" onClick={() => setShowAllLetters(true)}>View all</button>
      )}
    </HomeCard>
  );
}

/**
 * One newsletter, newest issue first. Swipe sideways for the older ones. A
 * combined row holds several senders' issues, each dated with who sent it.
 */
function NewsletterRow({ home, letters }: { home: HomeModel; letters: Letters }) {
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState<"combine" | "rename" | null>(null);
  const count = letters.issues.length;
  const initials = newsletterInitials(letters.name);
  const combined = letters.members.length > 1;
  const fromOf = new Map(letters.members.flatMap((member) => member.issues.map((issue) => [issue.id, member.name] as const)));
  const asked = home.letterSuggestion?.keys[0] === letters.key ? home.letterSuggestion : null;
  const others = home.newsletters.filter((row) => row.key !== letters.key && row.sender);
  return (
    <li data-testid="home-newsletter" className="rounded-xl bg-[#E7F1F6] dark:bg-[rgba(94,143,173,0.18)]">
      <div
        data-testid="home-newsletter-track"
        className="flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
        style={{ scrollbarWidth: "none" }}
        onScroll={(event) => {
          const track = event.currentTarget;
          setAt(Math.min(count - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)))));
        }}
      >
        {letters.issues.map((issue, index) => {
          const first = noteBullets(issue.description)[0];
          const when = combined ? `${fromOf.get(issue.id) ?? ""} · ${issueDateLabel(issue)}` : issueDateLabel(issue);
          return (
            <button
              key={issue.id}
              type="button"
              data-testid="home-newsletter-issue"
              aria-label={`${letters.name}, ${when}${count > 1 ? `, ${index + 1} of ${count}` : ""}`}
              className="flex w-full shrink-0 snap-start items-start gap-3 px-3 py-3 text-left"
              onClick={() => home.setSheet({ chore: issue, mode: "letter", letters })}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-sm font-black" style={{ color: logoInk(initials) }} aria-hidden="true">{initials}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{letters.name}</span>
                <span data-testid="home-newsletter-when" className="mt-0.5 block truncate text-xs text-[#6e6e78]">{when}</span>
                {first && <span data-testid="home-newsletter-highlight" className="mt-1 line-clamp-2 text-sm leading-snug">{first}</span>}
              </span>
              <ChevronRight className="mt-3 h-4 w-4 shrink-0 text-[#1e1e24]" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {/* Who it's for and a way to stop showing it, on every newsletter, not
          only inside All issues (2026-10-21). */}
      <div className="flex items-center gap-2 px-3 pb-2" data-testid="home-newsletter-footer">
        {count > 1 && (
          <>
            <span data-testid="home-newsletter-position" className="text-xs text-[#6e6e78]">{at + 1} of {count}</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              {letters.issues.map((issue, index) => (
                <span key={issue.id} data-testid="home-newsletter-dot" data-active={index === at} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: index === at ? "#5E8FAD" : "#b9cfdb" }} />
              ))}
            </span>
            <button type="button" className="py-1 text-xs font-semibold text-[#5E8FAD]" onClick={() => home.setSheet({ chore: letters.issues[0], mode: "issues", letters })}>
              All issues
            </button>
          </>
        )}
        <PersonChips
          home={home}
          profileIds={letters.issues[0]?.profileIds}
          title={letters.name}
          onPick={(ids) => home.reassignLetters(letters, ids)}
          sender={letters.sender}
        />
        {letters.sender && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" data-testid="home-newsletter-more" aria-label={`More for ${letters.name}`} className="grid h-7 w-7 shrink-0 place-items-center text-[#6e6e78]">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {others.length > 0 && <DropdownMenuItem data-testid="home-newsletter-combine" onSelect={() => setEditing("combine")}>Combine with…</DropdownMenuItem>}
              <DropdownMenuItem data-testid="home-newsletter-rename" onSelect={() => setEditing("rename")}>Rename</DropdownMenuItem>
              {combined && <DropdownMenuItem data-testid="home-newsletter-separate" onSelect={() => home.separateLetters(letters)}>Separate</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {letters.sender && (
          <button
            type="button"
            data-testid="home-newsletter-hide"
            aria-label={`Stop showing ${letters.name}`}
            className="grid h-7 w-7 shrink-0 place-items-center text-[#6e6e78]"
            onClick={() => void home.askHideLetters(letters)}
          >
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {/* A less clear match is asked about once, here (2026-10-22). */}
      {asked && (
        <div data-testid="home-newsletter-suggestion" className="flex items-center gap-2 border-t border-white/70 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">Same as <span className="font-semibold">{asked.names[1]}</span>?</span>
          <button
            type="button"
            data-testid="home-newsletter-suggestion-yes"
            className="rounded-full bg-[#5E8FAD] px-3 py-1 font-semibold text-white"
            onClick={() => home.combineLetters(home.newsletters.filter((row) => asked.keys.includes(row.key)))}
          >
            Combine
          </button>
          <button type="button" data-testid="home-newsletter-suggestion-no" className="px-2 py-1 font-semibold text-[#5E8FAD]" onClick={() => home.declineLetters(asked.pair)}>
            No
          </button>
        </div>
      )}
      {editing === "combine" && <CombineDialog home={home} letters={letters} others={others} onClose={() => setEditing(null)} />}
      {editing === "rename" && <RenameDialog home={home} letters={letters} onClose={() => setEditing(null)} />}
    </li>
  );
}

function CombineDialog({ home, letters, others, onClose }: { home: HomeModel; letters: Letters; others: Letters[]; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm" data-testid="home-newsletter-combine-dialog">
        <DialogHeader><DialogTitle>Combine with {letters.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Pick the newsletters that are really the same one. They'll show as one row.</p>
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {others.map((row) => (
            <li key={row.key}>
              <label className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-accent/50">
                <input type="checkbox" checked={picked.has(row.key)} onChange={() => toggle(row.key)} className="h-4 w-4 accent-[#5E8FAD]" />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            data-testid="home-newsletter-combine-save"
            disabled={picked.size === 0}
            onClick={() => {
              // The row it was started from keeps its name.
              home.combineLetters([letters, ...others.filter((row) => picked.has(row.key))], letters.name);
              onClose();
            }}
          >
            Combine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ home, letters, onClose }: { home: HomeModel; letters: Letters; onClose: () => void }) {
  const [name, setName] = useState(letters.name);
  const save = () => {
    if (name.trim()) home.renameLetters(letters, name);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm" data-testid="home-newsletter-rename-dialog">
        <DialogHeader><DialogTitle>Rename newsletter</DialogTitle></DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); save(); }}>
          <Input data-testid="home-newsletter-rename-input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus />
          <DialogFooter className="mt-4 grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" data-testid="home-newsletter-rename-save" disabled={!name.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
