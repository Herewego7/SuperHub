// Editing a LATER occurrence of a repeating series: the form must say where
// the repeat rule lives, beside the Repeat control itself (2026-09-14).

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { EventModal, type EventFormData } from "@/components/event-modal";
import { installMockApi, baselineRoutes } from "../mockApi";

const profiles = [{ id: "mom", name: "Mom", initials: "M", color: "#f59e0b" }] as any;

const selectedEvent = {
  id: "ev1", title: "Soccer practice",
  startTime: new Date("2026-08-25T19:00:00"), endTime: new Date("2026-08-25T20:30:00"),
  isAllDay: false, profileIds: ["mom"], location: "", description: "",
  // What the server sends for an occurrence that isn't the first one.
  isRecurringInstance: true, seriesId: "ev1",
  seriesStartTime: new Date("2026-09-14T19:00:00"),
} as any;

export function setup(): void {
  installMockApi(baselineRoutes({ "/api/profiles": profiles }));
}

export function Component() {
  const [formData, setFormData] = useState<EventFormData>({
    title: "Soccer practice", description: "",
    startTime: "2026-08-25T19:00", endTime: "2026-08-25T20:30",
    location: "", isAllDay: false, profileIds: ["mom"], drivingProfileIds: [],
    recurrenceType: "weekly",
    // exactly what the API sends and calendar3-view forwards unchanged
    recurrenceEndDate: "2026-12-30T00:00:00.000Z",
  } as any);
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; hour: number } | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <EventModal
        isOpen onClose={() => {}} highlightDrivingField={false}
        onSubmit={async () => {
          // mirror calendar3-view.tsx:1294 — what would actually be saved
          (window as any).__saved = {
            raw: formData.recurrenceEndDate,
            written: formData.recurrenceEndDate ? new Date(formData.recurrenceEndDate).toISOString() : null,
          };
        }}
        onDelete={async () => {}}
        isEditing profiles={profiles}
        formData={formData} setFormData={setFormData}
        selectedSlot={selectedSlot} setSelectedSlot={setSelectedSlot}
        selectedEvent={selectedEvent}
        isSubmitting={false} isDeleting={false} resetForm={() => {}}
        testIdPrefix="e2e-event"
      />
    </QueryClientProvider>
  );
}
