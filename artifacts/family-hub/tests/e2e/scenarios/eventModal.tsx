import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { EventModal, type EventFormData } from "@/components/event-modal";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [
  { id: "mom", name: "Mom", initials: "M", color: "#f59e0b" },
  { id: "truitt", name: "Truitt", initials: "T", color: "#3b82f6" },
] as any;

const selectedEvent = {
  id: "ev1",
  title: "Leadership Night",
  startTime: new Date("2026-08-25T19:00:00"),
  endTime: new Date("2026-08-25T20:30:00"),
  isAllDay: false,
  profileIds: ["mom", "truitt"],
  location: "",
  description: "",
} as any;

export function setup(): void {
  installMockApi(baselineRoutes({ "/api/profiles": profiles, "/api/comments": [] }));
}

export function Component() {
  const [formData, setFormData] = useState<EventFormData>({
    title: "Leadership Night",
    description: "",
    startTime: "2026-08-25T19:00",
    endTime: "2026-08-25T20:30",
    location: "",
    isAllDay: false,
    profileIds: ["mom", "truitt"],
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
