import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { clearInboxScan, readInboxScanOpen } from "@/lib/inboxScan";

export function InboxScanBanner() {
  const [open, setOpen] = useState(() => readInboxScanOpen());
  const applied = useRef<number | null>(null);
  const { data: settings } = useQuery<{ scanInbox?: boolean | null }>({ queryKey: ["/api/calendar-settings"] });
  const { data: scan } = useQuery<{ running: boolean; finishedAt: number | null }>({
    queryKey: ["/api/ingest/scan-status"],
    enabled: open,
    refetchInterval: open ? 15000 : false,
  });
  useEffect(() => {
    const sync = () => setOpen(readInboxScanOpen());
    window.addEventListener("superhub-inbox-scan", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("superhub-inbox-scan", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    if (!scan?.finishedAt || scan.running) return;
    if (applied.current === scan.finishedAt) return;
    applied.current = scan.finishedAt;
    void queryClient.invalidateQueries({ queryKey: ["/api/chores"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
    clearInboxScan();
  }, [scan]);
  if (!open || settings?.scanInbox === false) return null;
  return (
    <section className="plan-card flex items-start gap-3" data-testid="inbox-scan-banner">
      <span className="mt-1 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#5E8FAD] border-t-transparent" aria-hidden="true" />
      <div>
        <p className="text-[15px] font-semibold">Scanning your inbox</p>
        <p className="text-sm text-[#6e6e78]">Takes up to 24 hours. You can close the app. Home fills in when it's done.</p>
      </div>
    </section>
  );
}
