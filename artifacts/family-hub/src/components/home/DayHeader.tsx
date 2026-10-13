import { useRef } from "react";
import { Cloud, CloudRain, Snowflake, Sun } from "lucide-react";
import type { HomeModel } from "./useHomeDay";

export function DayHeader({ home }: { home: HomeModel }) {
  const { day, onShiftDay } = home.props;
  const { forecast } = home;
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onDaySwipe = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = null;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    onShiftDay?.(dx < 0 ? 1 : -1);
  };
  // The day arrows and Today live in the date row under the profiles, the same
  // as every other tab, so they stay on screen when Home is scrolled. This card
  // keeps the day's name and weather, and a sideways swipe still changes the day.
  return (
    <section
      className="plan-card flex touch-pan-y items-center gap-3"
      onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY }; }}
      onPointerUp={onDaySwipe}
      onPointerCancel={() => { drag.current = null; }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[22px] font-semibold leading-tight tracking-tight">{day.toLocaleDateString("en-US", { weekday: "long" })}</div>
        <div className="text-sm text-[#6e6e78]">{day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
      </div>
      {forecast && <ForecastMark high={forecast.high} low={forecast.low} condition={forecast.condition} />}
    </section>
  );
}

function ForecastMark({ high, low, condition }: { high: number; low: number; condition: string }) {
  const Icon = condition === "clear" ? Sun : condition === "rain" ? CloudRain : condition === "snow" ? Snowflake : Cloud;
  return (
    <div className="flex shrink-0 items-center gap-1 text-sm" aria-label={`${condition}, high ${high} degrees, low ${low}`}>
      <span className="font-medium">{Math.round(high)}°</span>
      <span className="text-[#6e6e78]">{Math.round(low)}°</span>
      <Icon className="h-5 w-5 text-[#F5B400]" aria-hidden="true" />
    </div>
  );
}
