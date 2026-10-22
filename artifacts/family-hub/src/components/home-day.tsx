import type { ComponentType } from "react";
import { DayHeader } from "@/components/home/DayHeader";
import { DrivingCard } from "@/components/home/DrivingCard";
import { EmailFiltersSheet } from "@/components/home/EmailFiltersSheet";
import { HorizonCard } from "@/components/home/HorizonCard";
import { InboxScanBanner } from "@/components/home/InboxScanBanner";
import { ItemSheet } from "@/components/home/ItemSheet";
import { KeyDatesCard } from "@/components/home/KeyDatesCard";
import { NewslettersCard } from "@/components/home/NewslettersCard";
import { NotesCard } from "@/components/home/NotesCard";
import { ScheduleCard } from "@/components/home/ScheduleCard";
import { TodosCard } from "@/components/home/TodosCard";
import { DEFAULT_CARD_CONFIG, type HomeCardId } from "@/components/home/registry";
import { useHomeDay, type HomeDayProps, type HomeModel } from "@/components/home/useHomeDay";

const CARDS: Record<HomeCardId, ComponentType<{ home: HomeModel }>> = {
  todos: TodosCard,
  keyDates: KeyDatesCard,
  newsletters: NewslettersCard,
  schedule: ScheduleCard,
  driving: DrivingCard,
  horizon: HorizonCard,
  notes: NotesCard,
};

export function HomeDay(props: HomeDayProps) {
  const home = useHomeDay(props);
  const cards = (props.cards ?? DEFAULT_CARD_CONFIG).filter((card) => card.visible).sort((a, b) => a.order - b.order);
  return (
    <div className="flex flex-col gap-3.5" data-testid="home-day">
      <InboxScanBanner />
      <DayHeader home={home} />
      {cards.map((card) => {
        const Card = CARDS[card.id];
        return <Card key={card.id} home={home} />;
      })}
      <ItemSheet home={home} />
      <EmailFiltersSheet home={home} />
    </div>
  );
}
