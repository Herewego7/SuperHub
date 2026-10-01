import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { EventModal, type EventFormData } from "@/components/event-modal";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "mom", name: "Mom", initials: "M", color: "#f59e0b" },
  { id: "dad", name: "Dad", initials: "D", color: "#3b82f6" },
  { id: "kid", name: "Kid", initials: "K", color: "#10b981" },
] as any;

const selectedEvent = {
  id: "ev1", title: "Soccer",
  startTime: new Date("2026-08-25T19:00:00"),
  endTime: new Date("2026-08-25T20:30:00"),
  isAllDay: false, profileIds: ["kid"], location: "", description: "",
} as any;

export function setup(): void {
  installMockApi(baselineRoutes({ "/api/profiles": profiles }));
}

export function Component() {
  const [formData, setFormData] = useState<EventFormData>({
    title: "Soccer", description: "", location: "", isAllDay: false,
    profileIds: ["kid"], drivingProfileIds: [],
    recurrenceType: "none", recurrenceEndDate: null,
  } as any);
  const [saved, setSaved] = useState<string>("");

  return (
    <QueryClientProvider client={queryClient}>
      <EventModal
        isOpen
        onClose={() => {}}
        // What the real save paths do: the two lists are saved separately.
        // Drivers are NOT merged into assignees — the server's calendarSync
        // ORs them at read time to reach each driver's own calendar.
        onSubmit={async (fd) => setSaved(JSON.stringify({
          drivingProfileIds: fd.drivingProfileIds,
          profileIds: fd.profileIds,
        }))}
        isEditing
        profiles={profiles}
        formData={formData}
        setFormData={setFormData as any}
        selectedSlot={{ start: selectedEvent.startTime, end: selectedEvent.endTime } as any}
        setSelectedSlot={() => {}}
        selectedEvent={selectedEvent}
        isSubmitting={false}
        isDeleting={false}
        resetForm={() => {}}
        testIdPrefix="e2e-event"
      />
      <div data-testid="saved-payload">{saved}</div>
    </QueryClientProvider>
  );
}
