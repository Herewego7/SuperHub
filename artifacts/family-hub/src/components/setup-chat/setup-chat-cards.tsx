// The pieces of the setup chat: bubbles, answer buttons, the cards that show
// what was just saved, and the composer. Sized and colored to match the Chat
// tab and the setup mockups.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ObjectUploader } from "@/components/ObjectUploader";
import { LocationWeatherChip } from "@/components/location-weather-chip";
import { apiUrl, objectUrl } from "@/lib/apiBase";
import { initialsOf } from "@/lib/setupChat/parse";
import { formatCode, timeZoneLabel, type Art, type Option, type OptionArt, type Person, type QuestionView, type RewardsNow, type SummaryRow, type Tint } from "@/lib/setupChat/script";
import { ART, BotAvatar, BothMini, COLORS, CoinMini, GiftMini, Icon, IconTile, ROUNDED_FONT, RoleArt } from "./illustrations";

const SHADOW = "shadow-[0_2px_10px_rgba(42,24,80,0.07)]";
const SURFACE = `bg-white dark:bg-card ${SHADOW}`;

export const TINTS: Record<Tint, string> = {
  sky: COLORS.sky,
  sage: COLORS.sage,
  lavender: COLORS.lavender,
  butter: COLORS.butter,
  peach: COLORS.peach,
};

/** Short names for the Parent PIN chips. Settings keeps the full labels. */
const PIN_SHORT: Record<string, string> = {
  createChore: "Chores",
  createBonusChore: "Bonus chores",
  createReward: "Rewards",
  calendarSettings: "Calendar settings",
  createTodo: "To-dos",
  settings: "Settings",
};

export function roleLabel(role: string | null | undefined): string {
  return role === "child" ? "Kid" : "Grown-up";
}

/** `**bold**` in the script's lines. */
export function richText(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>,
  );
}

// ── Bubbles ─────────────────────────────────────────────────────────────────

/** A row on the bot's side: the avatar gutter, then the content. */
export function BotRow({ avatar, children, wide = false }: { avatar?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-[26px] shrink-0">{avatar ? <BotAvatar /> : null}</div>
      <div className={`min-w-0 flex-1 ${wide ? "" : "pr-[18px]"}`}>{children}</div>
    </div>
  );
}

export function BotBubble({ avatar, text }: { avatar?: boolean; text: string }) {
  return (
    <BotRow avatar={avatar}>
      <div className={`w-fit max-w-[88%] rounded-[18px] px-3 py-2 text-sm leading-5 text-foreground ${SURFACE}`} data-testid="setup-chat-bot">
        {richText(text)}
      </div>
    </BotRow>
  );
}

export function MeBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[76%] items-center gap-1.5 whitespace-pre-wrap rounded-[18px] bg-[#5E8FAD] px-3 py-2 text-sm leading-5 text-white" data-testid="setup-chat-me">
        {children}
      </div>
    </div>
  );
}

export function MePin() {
  return (
    <MeBubble>
      <Icon name="lock" size={14} />
      <span className="tracking-[3px]" aria-label="PIN hidden">
        ••••
      </span>
    </MeBubble>
  );
}

export function MePhoto({ photoUrl }: { photoUrl: string }) {
  return (
    <div className="flex justify-end">
      <img src={objectUrl(photoUrl)} alt="Your photo" className="h-[88px] w-[88px] rounded-[18px] border-[3px] border-[#5E8FAD] object-cover" />
    </div>
  );
}

export function Typing() {
  return (
    <BotRow>
      <div
        data-testid="setup-chat-typing"
        role="status"
        aria-label="SuperHub is saving"
        className={`flex w-fit items-center gap-[5px] rounded-[20px] px-4 py-3.5 ${SURFACE}`}
      >
        {[0, 1, 2].map((index) => (
          <span key={index} className="chat-typing-dot block h-[7px] w-[7px] rounded-full bg-[#A0A0A8]" style={{ animationDelay: `${-(index * 0.172)}s` }} />
        ))}
      </div>
    </BotRow>
  );
}

export function PictureCard({ avatar, art, tint, title, body }: { avatar?: boolean; art: Art; tint: Tint; title: string; body?: string }) {
  const Picture = ART[art];
  return (
    <BotRow avatar={avatar}>
      <div className={`overflow-hidden rounded-[18px] ${SURFACE}`} data-testid={`setup-picture-${art}`}>
        <div style={{ background: TINTS[tint] }}>
          <Picture />
        </div>
        <div className="px-3.5 pb-[11px] pt-[9px]">
          <div className="text-base font-bold leading-[21px] text-foreground" style={{ fontFamily: ROUNDED_FONT }}>
            {title}
          </div>
          {body ? <div className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{body}</div> : null}
        </div>
      </div>
    </BotRow>
  );
}

export function Card({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={`rounded-2xl px-3.5 py-3 text-foreground ${SURFACE} ${className}`} data-testid={testId}>
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase leading-[14px] tracking-[0.5px] text-muted-foreground">{children}</div>;
}

// ── People ──────────────────────────────────────────────────────────────────

export function Avatar({ person, size = 40 }: { person: Pick<Person, "name" | "color" | "photoUrl">; size?: number }) {
  const box = { width: size, height: size };
  if (person.photoUrl) {
    return <img src={objectUrl(person.photoUrl)} alt="" className="shrink-0 rounded-full object-cover" style={{ ...box, border: `2px solid ${person.color}` }} />;
  }
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ ...box, background: person.color, fontSize: Math.round(size * 0.38) }}>
      {initialsOf(person.name) || "?"}
    </span>
  );
}

function PhotoPicker({ onPhoto, children, label }: { onPhoto: (photoUrl: string) => void; children: ReactNode; label: string }) {
  return (
    <ObjectUploader
      onComplete={(result) => onPhoto(result.objectPath)}
      buttonClassName="h-auto w-auto rounded-full bg-transparent p-0 text-foreground shadow-none hover:bg-transparent"
      withCrop
    >
      <span className="relative block" aria-label={label}>
        {children}
      </span>
    </ObjectUploader>
  );
}

export function ProfileCard({ avatar, person, line }: { avatar?: boolean; person: Person; line: "added" | "role" | "email" }) {
  const text =
    line === "added"
      ? `${roleLabel(person.role)} · added to your family`
      : line === "email"
        ? person.email || "No email on your profile"
        : roleLabel(person.role);
  return (
    <BotRow avatar={avatar}>
      <Card className="flex items-center gap-2.5 !py-2.5" testId="setup-card-profile">
        <Avatar person={person} size={38} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-[18px]">{person.name}</div>
          <div className="truncate text-xs leading-4 text-muted-foreground">{text}</div>
        </div>
      </Card>
    </BotRow>
  );
}

export function RosterCard({
  avatar,
  people,
  drafts = [],
  roles,
  camera,
  onPhoto,
}: {
  avatar?: boolean;
  people: Person[];
  drafts?: { name: string; color: string }[];
  roles?: boolean;
  camera?: boolean;
  onPhoto: (profileId: string, photoUrl: string) => void;
}) {
  const count = people.length + drafts.length;
  return (
    <BotRow avatar={avatar}>
      <Card className="!px-2" testId="setup-card-roster">
        <div className="grid gap-x-1 gap-y-3" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(count, 1), 4)}, minmax(0, 1fr))` }}>
          {people.map((person) => (
            <div key={person.id} className="flex min-w-0 flex-col items-center gap-1" data-testid="setup-roster-person">
              {camera ? (
                <PhotoPicker onPhoto={(url) => onPhoto(person.id, url)} label={`Add a photo of ${person.name}`}>
                  <Avatar person={person} size={46} />
                  {!person.photoUrl ? (
                    <span className="absolute -bottom-[3px] -right-[3px] grid h-5 w-5 place-items-center rounded-full border border-border bg-white text-muted-foreground">
                      <Icon name="camera" size={11} />
                    </span>
                  ) : null}
                </PhotoPicker>
              ) : (
                <Avatar person={person} size={46} />
              )}
              <div className="max-w-full truncate text-[13px] font-semibold leading-4">{person.name}</div>
              {roles ? <div className="text-[11px] leading-[14px] text-muted-foreground">{roleLabel(person.role)}</div> : null}
            </div>
          ))}
          {drafts.map((draft) => (
            <div key={`draft-${draft.name}`} className="flex min-w-0 flex-col items-center gap-1" data-testid="setup-roster-draft">
              <Avatar person={{ name: draft.name, color: draft.color }} size={46} />
              <div className="max-w-full truncate text-[13px] font-semibold leading-4">{draft.name}</div>
            </div>
          ))}
        </div>
      </Card>
    </BotRow>
  );
}

// ── What was saved ──────────────────────────────────────────────────────────

export function LocationCard({ avatar, city, region, timezone, live }: { avatar?: boolean; city: string; region: string; timezone?: string | null; live: boolean }) {
  const zone = timeZoneLabel(timezone);
  return (
    <BotRow avatar={avatar}>
      <Card className="flex items-center gap-2.5 !py-2.5" testId="setup-card-location">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: COLORS.sage, color: COLORS.coral }}>
          <Icon name="pin" size={21} />
        </span>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <div className="text-sm font-semibold leading-[18px]">
            {city}, {region}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {zone ? <span className="text-xs text-muted-foreground">{zone}</span> : null}
            {live ? <LocationWeatherChip /> : null}
          </div>
        </div>
      </Card>
    </BotRow>
  );
}

const PROVIDERS: { key: "googleCalendarConnected" | "outlookCalendarConnected" | "icalConnected"; label: string }[] = [
  { key: "googleCalendarConnected", label: "Google" },
  { key: "outlookCalendarConnected", label: "Outlook" },
  { key: "icalConnected", label: "iCal" },
];

export function CalendarsCard({ avatar, people }: { avatar?: boolean; people: Person[] }) {
  const linked = people.filter((p) => PROVIDERS.some((provider) => p[provider.key]));
  return (
    <BotRow avatar={avatar}>
      <Card className="!pb-1" testId="setup-card-calendars">
        <CardLabel>Calendar connections</CardLabel>
        {linked.length === 0 ? <div className="py-2 text-[13px] text-muted-foreground">No calendars connected yet</div> : null}
        {linked.map((person, index) => (
          <div key={person.id} className={`flex items-center gap-2.5 py-2 ${index ? "border-t border-border" : ""}`}>
            <Avatar person={person} size={28} />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold">{person.name}</div>
            <div className="flex flex-wrap justify-end gap-1">
              {PROVIDERS.filter((provider) => person[provider.key]).map((provider) => (
                <span key={provider.key} className="inline-flex items-center gap-1 rounded-full bg-[hsl(140_30%_92%)] px-2 py-0.5 text-xs font-semibold text-[hsl(140_35%_30%)]">
                  <Icon name="check" size={12} />
                  {provider.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </BotRow>
  );
}

function starsPerDollar(centsPerPoint: number): string {
  return String(Math.round((100 / centsPerPoint) * 100) / 100);
}

export function RewardsCard({ avatar, rewards }: { avatar?: boolean; rewards: RewardsNow | null }) {
  if (!rewards) return null;
  const symbol = rewards.currencySymbol || "$";
  const rows: { icon: "star" | "lock"; text: string }[] = [
    { icon: "star", text: rewards.pointsMode === "per_completion" ? `${rewards.completionBonusPoints} stars for finishing the day` : "Stars for each chore" },
    {
      icon: "star",
      text:
        rewards.redemptionMode === "rewards_only"
          ? "Spent on rewards"
          : `${rewards.redemptionMode === "both" ? "Spend or cash out" : "Cashed out"} · ${starsPerDollar(rewards.centsPerPoint)} stars = ${symbol}1`,
    },
    { icon: "lock", text: rewards.hasParentPin ? "Parent PIN on" : "No Parent PIN" },
  ];
  return (
    <BotRow avatar={avatar}>
      <Card className="!pb-1 !pt-1" testId="setup-card-rewards">
        {rows.map((row, index) => (
          <div key={row.text} className={`flex items-center gap-2.5 py-2 ${index ? "border-t border-border" : ""}`}>
            <span className="text-[#5E8FAD]">
              <Icon name={row.icon} size={16} />
            </span>
            <span className="min-w-0 flex-1 text-[13px] leading-[17px]">{row.text}</span>
          </div>
        ))}
      </Card>
    </BotRow>
  );
}

export function PinLocksCard({ avatar, title, features, labels }: { avatar?: boolean; title: string; features: string[]; labels: Record<string, string> }) {
  return (
    <BotRow avatar={avatar}>
      <Card className="!pb-3 !pt-2.5" testId="setup-card-pin-locks">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-[#5E8FAD]">
            <Icon name="lock" size={15} />
          </span>
          {title}
        </div>
        {features.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {features.map((key) => (
              <span key={key} className="inline-flex items-center gap-1 rounded-full bg-[#E7F1F6] px-2.5 py-[3px] text-xs font-semibold text-[#46708A]">
                <Icon name="check" size={12} />
                {PIN_SHORT[key] ?? labels[key] ?? key}
              </span>
            ))}
          </div>
        ) : null}
      </Card>
    </BotRow>
  );
}

function joinLink(code: string): string {
  const path = `/join?code=${code}`;
  const resolved = apiUrl(path);
  return /^https?:\/\//i.test(resolved) ? resolved : `${window.location.origin}${path}`;
}

function SmallButton({ icon, label, filled, onClick, testId }: { icon: "copy" | "link" | "check"; label: string; filled?: boolean; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-[7px] text-[13px] font-semibold ${
        filled ? "border-[#5E8FAD] bg-[#5E8FAD] text-white" : "border-border bg-white text-[#5E8FAD] dark:bg-card"
      }`}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

export function CodeCard({ avatar, code, email }: { avatar?: boolean; code: string; email?: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (what: "code" | "link") => {
    navigator.clipboard?.writeText(what === "code" ? code : joinLink(code)).then(() => {
      setCopied(what);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
    });
  };
  return (
    <BotRow avatar={avatar}>
      <Card testId="setup-card-code">
        <CardLabel>{email ? `Invite for ${email}` : "Invite code"}</CardLabel>
        <div className="mb-2.5 mt-1 font-mono text-2xl font-bold leading-[30px] tracking-[3px]" data-testid="setup-invite-code">
          {formatCode(code)}
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallButton icon={copied === "code" ? "check" : "copy"} label={copied === "code" ? "Copied" : "Copy code"} filled onClick={() => copy("code")} testId="setup-copy-code" />
          <SmallButton icon={copied === "link" ? "check" : "link"} label={copied === "link" ? "Copied" : "Copy link"} onClick={() => copy("link")} testId="setup-copy-link" />
        </div>
        <div className="mt-2.5 text-xs leading-4 text-muted-foreground">They open SuperHub, tap Join a family, and type this code.</div>
      </Card>
    </BotRow>
  );
}

export function SummaryCard({
  avatar,
  people,
  names,
  rows,
  changeFamily,
  weather,
  onChange,
}: {
  avatar?: boolean;
  people: Person[];
  names: string;
  rows: SummaryRow[];
  changeFamily: boolean;
  weather: string | null;
  /** Set only on the summary that is still live; older copies are read-only. */
  onChange?: (id: string) => void;
}) {
  const change = (id: string, label: string) =>
    onChange ? (
      <button type="button" className="shrink-0 text-xs font-semibold text-[#5E8FAD]" onClick={() => onChange(id)} data-testid={`setup-change-${id}`} aria-label={`Change ${label}`}>
        Change
      </button>
    ) : null;
  return (
    <BotRow avatar={avatar}>
      <Card className="!pb-1" testId="setup-card-summary">
        <div className="flex items-center gap-2.5 pb-2">
          <div className="flex shrink-0">
            {people.slice(0, 6).map((person, index) => (
              <span key={person.id} className="rounded-full border-2 border-white dark:border-card" style={{ marginLeft: index ? -8 : 0 }}>
                <Avatar person={person} size={30} />
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1 text-[13px] font-semibold leading-[17px]">{names}</div>
          {changeFamily ? change("family", "family") : null}
        </div>
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2.5 border-t border-border py-2" data-testid={`setup-summary-${row.id}`}>
            <span className="text-[#5E8FAD]">
              <Icon name={row.icon} size={16} />
            </span>
            <span className="min-w-0 flex-1 text-[13px] leading-[17px]">
              {row.text}
              {row.id === "location" && weather ? ` · ${weather}` : ""}
            </span>
            {row.change ? change(row.id, row.id) : null}
          </div>
        ))}
      </Card>
    </BotRow>
  );
}

// ── Answers ─────────────────────────────────────────────────────────────────

function NumberBadge({ n, size = 22, inverted = false }: { n: number; size?: number; inverted?: boolean }) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-full text-xs font-bold text-[#5E8FAD] ${inverted ? "bg-white" : "bg-[#E7F1F6]"}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

function OptionPicture({ art, tile, people }: { art: OptionArt; tile?: boolean; people: Person[] }) {
  switch (art.kind) {
    case "icon":
      return <IconTile name={art.icon} />;
    case "avatar": {
      const person = people.find((p) => p.id === art.profileId);
      return person ? <Avatar person={person} size={32} /> : null;
    }
    case "role":
      return <RoleArt kid={art.role === "child"} size={tile ? 58 : 32} />;
    case "trophy":
      return (
        <img
          src={art.trophy === "chore" ? "/trophies/chore_count_1.png" : "/trophies/perfect_day.png"}
          alt=""
          className="object-contain"
          style={{ width: tile ? 58 : 32, height: tile ? 58 : 32 }}
        />
      );
    case "spend":
      return art.spend === "rewards" ? <GiftMini /> : art.spend === "cash" ? <CoinMini /> : <BothMini />;
  }
}

const ROW = "flex min-h-[44px] w-full items-center gap-2.5 rounded-[14px] border px-3 py-[7px] text-left";

function RowContent({ option, n, people }: { option: Option; n: number | null; people: Person[] }) {
  return (
    <>
      {n !== null ? <NumberBadge n={n} inverted={option.primary} /> : null}
      {option.art ? <OptionPicture art={option.art} people={people} /> : null}
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-[18px]">{option.label}</span>
        {option.hint ? <span className={`block text-xs leading-4 ${option.primary ? "text-[#E7F1F6]" : "text-muted-foreground"}`}>{option.hint}</span> : null}
      </span>
    </>
  );
}

export function Answers({
  view,
  people,
  disabled,
  onPick,
  onPhoto,
  photoFor,
}: {
  view: QuestionView;
  people: Person[];
  disabled: boolean;
  onPick: (id: string) => void;
  onPhoto: (profileId: string, photoUrl: string) => void;
  /** Whose photo the upload answers set. */
  photoFor?: string;
}) {
  if (view.options.length === 0) return null;
  const numberOf = (option: Option) => (view.numbered ? view.options.indexOf(option) + 1 : null);
  const tiles = view.options.filter((o) => o.tile);
  const rest = view.options.filter((o) => !o.tile);

  if (view.layout === "chips") {
    return (
      <BotRow>
        <div className={`flex flex-wrap gap-1.5 ${disabled ? "pointer-events-none opacity-60" : ""}`} data-testid="setup-answers">
          {view.options.map((option) => {
            const n = numberOf(option);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onPick(option.id)}
                data-testid={`setup-option-${option.id}`}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full py-[5px] text-sm font-semibold ${n !== null ? "pl-[5px] pr-3" : "px-3.5"} ${
                  option.primary ? "bg-[#5E8FAD] text-white" : "bg-[#E7F1F6] text-[#5E8FAD]"
                }`}
              >
                {n !== null ? <NumberBadge n={n} inverted /> : null}
                {option.art?.kind === "icon" ? <Icon name={option.art.icon} size={14} /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
      </BotRow>
    );
  }

  return (
    <BotRow>
      <div className={`flex flex-col gap-1.5 ${disabled ? "pointer-events-none opacity-60" : ""}`} data-testid="setup-answers">
        {tiles.length ? (
          <div className="grid grid-cols-2 gap-2">
            {tiles.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onPick(option.id)}
                data-testid={`setup-option-${option.id}`}
                className="relative rounded-2xl border border-border bg-white px-2 pb-2.5 pt-3 text-center text-foreground dark:bg-card"
              >
                {view.numbered ? (
                  <span className="absolute left-2 top-2">
                    <NumberBadge n={numberOf(option)!} size={20} />
                  </span>
                ) : null}
                <span className="flex h-[62px] items-center justify-center">{option.art ? <OptionPicture art={option.art} tile people={people} /> : null}</span>
                <span className="mt-1.5 block text-[13px] font-semibold leading-[17px]">{option.label}</span>
                {option.hint ? <span className="mt-0.5 block text-[11px] leading-[15px] text-muted-foreground">{option.hint}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        {rest.map((option) => {
          const n = numberOf(option);
          const look = option.primary ? "border-[#5E8FAD] bg-[#5E8FAD] text-white" : "border-border bg-white text-foreground dark:bg-card";
          if (option.upload) {
            return (
              <ObjectUploader
                key={option.id}
                onComplete={(result) => photoFor && onPhoto(photoFor, result.objectPath)}
                buttonClassName={`${ROW} ${look} h-auto justify-start whitespace-normal font-normal shadow-none hover:bg-white dark:hover:bg-card`}
                withCrop
                capture={option.upload === "camera" ? "user" : undefined}
              >
                <span className="contents" data-testid={`setup-option-${option.id}`}>
                  <RowContent option={option} n={n} people={people} />
                </span>
              </ObjectUploader>
            );
          }
          return (
            <button key={option.id} type="button" onClick={() => onPick(option.id)} data-testid={`setup-option-${option.id}`} className={`${ROW} ${look}`}>
              <RowContent option={option} n={n} people={people} />
            </button>
          );
        })}
      </div>
    </BotRow>
  );
}

/** The Parent PIN checklist: tap to turn each lock on or off. */
export function PinChooseCard({ features, on, onToggle, disabled }: { features: { key: string; label: string }[]; on: string[]; onToggle: (key: string) => void; disabled: boolean }) {
  return (
    <BotRow>
      <Card className={`!px-1.5 !py-1 ${disabled ? "pointer-events-none opacity-60" : ""}`} testId="setup-card-pin-choose">
        {features.map((feature, index) => {
          const checked = on.includes(feature.key);
          return (
            <button
              key={feature.key}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => onToggle(feature.key)}
              data-testid={`setup-pin-feature-${feature.key}`}
              className={`flex w-full items-center gap-2.5 px-2 py-2 text-left ${index ? "border-t border-border" : ""}`}
            >
              <NumberBadge n={index + 1} size={20} />
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] ${checked ? "border-[#5E8FAD] bg-[#5E8FAD] text-white" : "border-muted-foreground text-transparent"}`}
                aria-hidden="true"
              >
                <Icon name="check" size={12} />
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-[17px]">{feature.label}</span>
            </button>
          );
        })}
      </Card>
    </BotRow>
  );
}

// ── Composer ────────────────────────────────────────────────────────────────

function SendButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="submit"
      aria-label="Send"
      disabled={disabled}
      data-testid="setup-chat-send"
      className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-[#5E8FAD] text-white disabled:opacity-45"
    >
      <Icon name="send" size={17} />
    </button>
  );
}

function PinComposer({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [pin, setPin] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  const submit = (digits: string) => {
    if (digits.length !== 4 || disabled) return;
    onSend(digits);
    setPin("");
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit(pin);
      }}
    >
      <label className="relative flex min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-border bg-white px-4 py-2.5 text-sm dark:bg-card">
        <span className="text-muted-foreground">
          <Icon name="lock" size={15} />
        </span>
        <span className="inline-flex gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((slot) => (
            <span
              key={slot}
              className={`block h-[9px] w-[9px] rounded-full border-[1.5px] ${slot < pin.length ? "border-foreground bg-foreground" : "border-muted-foreground"}`}
            />
          ))}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">Number pad</span>
        <input
          ref={input}
          value={pin}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
            setPin(digits);
            if (digits.length === 4) submit(digits);
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={4}
          aria-label="4-digit PIN"
          data-testid="setup-chat-pin"
          className="absolute inset-0 h-full w-full cursor-text rounded-full opacity-0"
          style={{ WebkitTextSecurity: "disc" } as CSSProperties}
        />
      </label>
      <SendButton disabled={disabled || pin.length !== 4} />
    </form>
  );
}

export function Composer({ question, view, disabled, onSend }: { question: string; view: QuestionView; disabled: boolean; onSend: (text: string) => void }) {
  if (view.input === "none") return null;
  if (view.input === "pin") return <PinComposer key={question} onSend={onSend} disabled={disabled} />;
  return <TextComposer question={question} view={view} disabled={disabled} onSend={onSend} />;
}

function TextComposer({ question, view, disabled, onSend }: { question: string; view: QuestionView; disabled: boolean; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const sent = useRef(false);
  const tapToAnswer = view.options.length >= 2;
  // After a typed reply, the keyboard steps aside when the next question is
  // answered with a tap, and stays up when it wants more typing.
  useEffect(() => {
    if (sent.current && tapToAnswer && document.activeElement === input.current) input.current?.blur();
    sent.current = false;
    // Only a new question should move focus, not a refetch redrawing this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);
  const email = view.inputMode === "email";
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.trim() || disabled) return;
        sent.current = true;
        onSend(draft);
        setDraft("");
      }}
    >
      <input
        ref={input}
        data-testid="setup-chat-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={view.placeholder}
        aria-label={view.placeholder}
        type={email ? "email" : "text"}
        inputMode={view.inputMode === "numeric" ? "decimal" : email ? "email" : "text"}
        autoCapitalize={email || view.inputMode === "numeric" ? "none" : view.autoCapitalize ?? "sentences"}
        autoCorrect="off"
        autoComplete="off"
        enterKeyHint="send"
        className="min-w-0 flex-1 rounded-full border border-border bg-white px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground dark:bg-card"
      />
      <SendButton disabled={disabled || !draft.trim()} />
    </form>
  );
}

/** Settings' own calendar list, inside the chat. */
export function CalendarLiveCard({ children }: { children: ReactNode }) {
  return (
    <BotRow wide>
      <Card className="!px-3" testId="setup-card-calendar-live">
        {children}
      </Card>
    </BotRow>
  );
}

