import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Chore } from "@workspace/shared-types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiRequest } from "@/lib/queryClient";
import { issueDateLabel, mailSpan, planDateLabel, snoozeUntil } from "@/lib/homeDay";
import { canReadOriginal, noteBullets, schoolSaveTarget, slipHeader, slipMailOwner, slipSender, slipSenderName } from "@/lib/slipMail";
import type { HomeModel, Letters, Person } from "./useHomeDay";

export function ItemSheet({ home }: { home: HomeModel }) {
  const { people, personId, kidName, onEditTodo } = home.props;
  const { sheet, setSheet, now, kept, snoozeItem, removeRow, askStopEmails, removeFromCalendar, saveSchool, placeMail, calendarSettings } = home;
  const canRead = (chore: Chore) => canReadOriginal(calendarSettings?.shareOriginals === true, slipMailOwner(chore.description), { id: personId, isChild: !!kidName });
  const [customSnooze, setCustomSnooze] = useState("");
  return (
    <Sheet open={!!sheet} onOpenChange={(open) => { if (!open) setSheet(null); }}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl">
        {sheet?.mode === "snooze" && (
          <>
            <SheetHeader><SheetTitle>Snooze</SheetTitle></SheetHeader>
            <div className="mt-3 flex flex-col">
              {(["tonight", "tomorrow", "weekend"] as const).map((which) => {
                const until = snoozeUntil(which, now);
                if (until == null) return null;
                const label = which === "tonight" ? "Tonight" : which === "tomorrow" ? "Tomorrow morning" : "This weekend";
                return (
                  <button key={which} type="button" className="flex items-center justify-between border-t border-[#ececf0] py-3 text-left first:border-t-0" onClick={() => snoozeItem(sheet.chore.id, until)}>
                    <span>{label}</span>
                    <span className="text-sm text-[#6e6e78]">{new Date(until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
                  </button>
                );
              })}
              <label className="mt-2 flex flex-col gap-2 text-sm">
                Pick a date and time
                <input type="datetime-local" value={customSnooze} onChange={(event) => setCustomSnooze(event.target.value)} className="rounded-lg border border-border px-2 py-2" />
              </label>
              <button type="button" className="mt-2 font-semibold text-[#5E8FAD]" onClick={() => snoozeItem(sheet.chore.id, snoozeUntil("custom", now, customSnooze ? new Date(customSnooze) : undefined))}>Snooze until then</button>
            </div>
          </>
        )}
        {sheet?.mode === "source" && (
          <>
            <SheetHeader><SheetTitle>{sheet.chore.title}</SheetTitle></SheetHeader>
            <NoteBullets description={sheet.chore.description} />
            {canRead(sheet.chore) && <ReadFullEmail key={sheet.chore.id} chore={sheet.chore} viewer={personId ?? null} />}
          </>
        )}
        {sheet?.mode === "letter" && <LetterView home={home} chore={sheet.chore} letters={sheet.letters} canRead={canRead(sheet.chore)} />}
        {sheet?.mode === "issues" && sheet.letters && <IssueList home={home} letters={sheet.letters} />}
        {sheet?.mode === "actions" && (
          <ActionList
            chore={sheet.chore}
            keyDate={!!sheet.keyDate}
            personId={personId}
            people={people}
            added={!!kept[sheet.chore.id]}
            onEdit={() => { setSheet(null); onEditTodo?.(sheet.chore); }}
            onSnooze={() => setSheet({ ...sheet, mode: "snooze" })}
            onClaim={() => { if (personId) home.reassign(sheet.chore, [personId]); setSheet(null); }}
            onRemove={() => removeRow(sheet.chore)}
            onStopEmails={() => { setSheet(null); void askStopEmails(sheet.chore); }}
            onCalendar={() => {
              const span = mailSpan(`${sheet.chore.title}\n${sheet.chore.description ?? ""}`, now);
              if (kept[sheet.chore.id]) removeFromCalendar.mutate({ choreId: sheet.chore.id, eventId: kept[sheet.chore.id] });
              else if (span) placeMail(sheet.chore, span.start, !span.time);
              setSheet(null);
            }}
            onSave={(offer) => { saveSchool.mutate(offer); setSheet(null); }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

/** One newsletter issue: when it was sent, the date it is about, and its highlights. */
function LetterView({ home, chore, letters, canRead }: { home: HomeModel; chore: Chore; letters?: Letters; canRead: boolean }) {
  const { now, setSheet, askHideLetters } = home;
  const sentAt = letters?.issues.find((issue) => issue.id === chore.id)?.when ?? (chore.createdAt ? new Date(chore.createdAt) : now);
  const span = mailSpan(`${chore.title}\n${chore.description ?? ""}`, sentAt);
  const name = letters?.name ?? chore.title;
  return (
    <>
      <SheetHeader><SheetTitle>{name}</SheetTitle></SheetHeader>
      {chore.title !== name && <p className="mt-1 text-sm">{chore.title}</p>}
      <p data-testid="home-letter-sent" className="mt-1 text-xs text-[#6e6e78]">Sent {sentAt.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" })}</p>
      {span && <p data-testid="home-letter-date" className="mt-3 text-sm font-medium">Date in the letter: {planDateLabel(span.start, span.end)}</p>}
      <NoteBullets description={chore.description} />
      {canRead && <ReadFullEmail key={chore.id} chore={chore} viewer={home.props.personId ?? null} />}
      {letters?.sender && (
        <button
          type="button"
          data-testid="home-letter-hide"
          className="mt-3 w-full rounded-full py-2.5 text-sm font-medium text-destructive"
          onClick={() => { setSheet(null); void askHideLetters(letters); }}
        >
          Stop showing this newsletter
        </button>
      )}
    </>
  );
}

/** Every issue of one newsletter from the last 30 days, newest first. */
function IssueList({ home, letters }: { home: HomeModel; letters: Letters }) {
  return (
    <>
      <SheetHeader><SheetTitle>{letters.name}</SheetTitle></SheetHeader>
      <p className="mt-1 text-xs text-[#6e6e78]">{letters.issues.length === 1 ? "1 issue" : `${letters.issues.length} issues`} in the last 30 days</p>
      <ul data-testid="home-letter-issues" className="mt-3 flex flex-col">
        {letters.issues.map((issue) => {
          const first = noteBullets(issue.description)[0];
          return (
            <li key={issue.id} className="border-t border-[#ececf0] first:border-t-0">
              <button type="button" className="flex w-full items-start gap-3 py-3 text-left" onClick={() => home.setSheet({ chore: issue, mode: "letter", letters })}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{issueDateLabel(issue)}</span>
                  {first && <span className="mt-0.5 line-clamp-2 text-sm text-[#6e6e78]">{first}</span>}
                </span>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#a0a0a8]" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The note as a bulleted list. */
export function NoteBullets({ description }: { description: string | null | undefined }) {
  const bullets = noteBullets(description);
  if (bullets.length === 0) return <p className="mt-3 text-sm text-[#6e6e78]">No note on this one.</p>;
  return (
    <ul data-testid="home-note-bullets" className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-snug">
      {bullets.map((line, at) => <li key={`${at}-${line}`}>{line}</li>)}
    </ul>
  );
}

type OriginalMail = { subject: string; from: string; sentAt: string | null; text: string; webUrl: string | null };

/** Opens the email this came from, fetched from the mailbox it arrived in. Nothing is kept. */
export function ReadFullEmail({ chore, viewer }: { chore: Chore; viewer: string | null }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "open" | "failed"; mail?: OriginalMail; error?: string }>({ status: "idle" });
  const provider = slipHeader(chore.description).Mail?.split(":")[0];
  const open = async () => {
    setState({ status: "loading" });
    try {
      const query = `choreId=${encodeURIComponent(chore.id)}${viewer ? `&viewer=${encodeURIComponent(viewer)}` : ""}`;
      const res = await apiRequest("GET", `/api/ingest/original?${query}`);
      setState({ status: "open", mail: await res.json() as OriginalMail });
    } catch (error) {
      setState({ status: "failed", error: error instanceof Error ? error.message : "Couldn't open that email right now." });
    }
  };
  if (state.status === "open" && state.mail) {
    const { mail } = state;
    return (
      <div data-testid="home-full-email" className="mt-4 border-t border-[#ececf0] pt-3">
        <p className="text-[15px] font-medium">{mail.subject}</p>
        <p className="mt-0.5 text-xs text-[#6e6e78]">
          {mail.from}{mail.sentAt ? ` · ${new Date(mail.sentAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
        </p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{mail.text}</p>
        {mail.webUrl && (
          <a href={mail.webUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-[#5E8FAD]">
            {provider === "outlook" ? "Open in Outlook" : "Open in Gmail"}
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="mt-4">
      <button
        type="button"
        data-testid="home-read-full-email"
        className="w-full rounded-full bg-[#F1F1F4] py-2.5 text-sm font-medium disabled:opacity-60"
        disabled={state.status === "loading"}
        onClick={() => void open()}
      >
        {state.status === "loading" ? "Opening…" : "Read full email"}
      </button>
      {state.status === "failed" && <p className="mt-2 text-sm text-destructive">{state.error}</p>}
    </div>
  );
}

function ActionList({ chore, keyDate, personId, people, added, onEdit, onSnooze, onClaim, onRemove, onStopEmails, onCalendar, onSave }: {
  chore: Chore;
  keyDate: boolean;
  personId?: string | null;
  people: Person[];
  added: boolean;
  onEdit: () => void;
  onSnooze: () => void;
  onClaim: () => void;
  onRemove: () => void;
  onStopEmails: () => void;
  onCalendar: () => void;
  onSave: (offer: { profileId: string; school: string }) => void;
}) {
  const sender = slipSender(chore.description);
  const senderName = slipSenderName(chore.description) ?? sender;
  const isMail = chore.category === "school_email";
  const whoId = (chore.profileIds ?? [])[0];
  const offer = schoolSaveTarget(chore.title, chore.description, people, personId ?? null);
  const rows: { label: string; detail: string; onClick: () => void; danger?: boolean; testId?: string }[] = [
    { label: "Edit", detail: "Change the title, date, or who it's for.", onClick: onEdit },
    { label: "Snooze", detail: "Hide it until a time you pick. It comes back then.", onClick: onSnooze },
  ];
  if (!keyDate && personId && whoId !== personId) rows.push({ label: "I'll do it", detail: "Assign it to you so the other parent sees you took it.", onClick: onClaim });
  if (keyDate) rows.push({ label: added ? "Remove from calendar" : "Add to calendar", detail: added ? "Take this date back off the calendar." : "Put this date on the family calendar.", onClick: onCalendar });
  if (offer) rows.push({ label: `Save ${offer.school}`, detail: offer.profileId === personId ? "Remember this school." : `Remember this school for ${offer.name}.`, onClick: () => onSave(offer), testId: "home-todo-save-school" });
  rows.push(isMail
    ? { label: "Remove", detail: "Remove this item for good.", onClick: onRemove, danger: true, testId: "home-todo-remove" }
    : { label: "Delete", detail: "Delete this to-do.", onClick: onRemove, danger: true, testId: "home-todo-delete" });
  if (sender) rows.push({ label: `Stop emails from ${senderName}`, detail: "Clears their open items and skips their future email. You can undo this in Settings.", onClick: onStopEmails, danger: true, testId: "home-todo-stop-emails" });
  return (
    <div className="flex flex-col">
      <SheetHeader className="mb-2"><SheetTitle className="text-left">{chore.title}</SheetTitle></SheetHeader>
      {rows.map((row) => (
        <button key={row.label} type="button" data-testid={row.testId} className={`flex items-start gap-3 border-t border-[#ececf0] py-3 text-left ${row.danger ? "text-destructive" : ""}`} onClick={row.onClick}>
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
          <span>
            <span className="block text-[15px]">{row.label}</span>
            <span className="mt-0.5 block text-xs text-[#6e6e78]">{row.detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
