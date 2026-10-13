import type { MouseEvent, ReactNode } from "react";
import { eventTint } from "@/lib/eventTint";

/** The person strip down a row's left edge: one segment per person on a shared event. */
export function PersonStrip({ colors }: { colors: string[] }) {
  return (
    <span data-testid="event-strip" aria-hidden="true" className="flex w-1 shrink-0 flex-col gap-px self-stretch overflow-hidden rounded-full">
      {colors.map((color, at) => (
        <span key={`${at}-${color}`} data-color={color} className="min-h-[6px] flex-1" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}

type EventRowProps = {
  colors: string[];
  title: ReactNode;
  /** The time column. Left out, the row has none. */
  time?: ReactNode;
  detail?: ReactNode;
  chips?: ReactNode;
  /** A wash of the first person's color behind the row. */
  tinted?: boolean;
  /** A time that is only in an email, not on any calendar. */
  dashed?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
  testId?: string;
  className?: string;
};

/** One event on Home or in Calendar's Upcoming list. */
export function EventRow({ colors, title, time, detail, chips, tinted, dashed, onClick, onContextMenu, testId, className = "" }: EventRowProps) {
  const color = colors[0];
  const style = {
    backgroundColor: tinted && !dashed ? eventTint(color) : undefined,
    border: dashed ? `1.5px dashed ${color}` : undefined,
  };
  const classes = `flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-sm ${className}`;
  const body = (
    <>
      <PersonStrip colors={colors} />
      {time !== undefined && <span data-testid="event-time" className="w-[4.25rem] shrink-0 text-xs leading-5 text-[#6e6e78]">{time}</span>}
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-5">{title}</span>
        {detail && <span className="mt-0.5 block text-[#6e6e78]">{detail}</span>}
        {chips}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" data-testid={testId} className={classes} style={style} onClick={onClick} onContextMenu={onContextMenu}>{body}</button>
  ) : (
    <div data-testid={testId} className={classes} style={style}>{body}</div>
  );
}
