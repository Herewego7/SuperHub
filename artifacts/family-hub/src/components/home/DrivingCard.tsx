import { appendPlace, eventClockLine } from "@/lib/chatTools";
import { HomeCard } from "./HomeCard";
import type { HomeModel } from "./useHomeDay";

export function DrivingCard({ home }: { home: HomeModel }) {
  const { drives } = home;
  if (drives.length === 0) return null;
  return (
    <HomeCard
      id="driving"
      testId="home-driving"
      title="Driving"
      summary={drives.length === 1 ? "1 drive" : `${drives.length} drives`}
      collapsed={home.isCollapsed("driving")}
      onToggle={() => home.toggleCard("driving")}
    >
      <ul className="flex flex-col gap-1">
        {drives.map((event) => (
          <li key={event.id} className="text-sm">
            {appendPlace(eventClockLine(event.title, event.startTime, true, event.isAllDay === true), event.location)}
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
