import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { EventModal, type EventFormData } from "@/components/event-modal";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "mom", name: "Mom", initials: "M", color: "#f59e0b" },
] as any;

const LONG_DESC =
  `<hr><b>NOTE:</b> You can <b>only</b> edit/save changes to this calendar event via your <a href="https://calendar.google.com/calendar/u/0/r/eventedit/abc123def456ghi789">Google Calendar app or web page</a>. Changes made here in Family Hub will not sync back to Google.\n\n` +
  `Location: 123 Example Street, Some City, ST 55555\n\n` +
  `Please arrive 15 minutes early for check-in. Bring your own water bottle and a folding chair if you have one. Parking is available in the north lot; overflow parking is across the street at the community center.\n\n` +
  `Agenda:\n1. Welcome and introductions\n2. Main session\n3. Small group breakouts\n4. Closing remarks and next steps\n\n` +
  `Contact the front office with any questions.`;

const selectedEvent = {
  id: "ev1",
  title: "Leadership Night",
  startTime: new Date("2026-08-25T19:00:00"),
  endTime: new Date("2026-08-25T20:30:00"),
  isAllDay: true,
  profileIds: ["mom"],
  location: "",
  description: LONG_DESC,
} as any;

export function setup(): void {
  installMockApi(baselineRoutes({ "/api/profiles": profiles }));
}

export function Component() {
  const [formData, setFormData] = useState<EventFormData>({
    title: "Leadership Night",
    description: LONG_DESC,
    startTime: "2026-08-25T19:00",
    endTime: "2026-08-25T20:30",
    location: "",
    isAllDay: true,
    profileIds: ["mom"],
    drivingProfileIds: [],
    recurrenceType: null,
    recurrenceEndDate: null,
  } as any);
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; hour: number } | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <EventModal
        isOpen
        onClose={() => {}}
        highlightDrivingField={false}
        onSubmit={async () => {}}
        onDelete={async () => {}}
        isEditing
        profiles={profiles}
        formData={formData}
        setFormData={setFormData}
        selectedSlot={selectedSlot}
        setSelectedSlot={setSelectedSlot}
        selectedEvent={selectedEvent}
        isSubmitting={false}
        isDeleting={false}
        resetForm={() => {}}
        testIdPrefix="e2e-event"
      />
    </QueryClientProvider>
  );
}
