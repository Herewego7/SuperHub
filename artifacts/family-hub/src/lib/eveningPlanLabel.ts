export function planScheduleLabel(time: string | null | undefined, timing: string | null | undefined): string | null {
  if (!time) return null;
  return timing === "morningOf" ? `Morning of, ${time}` : `Evening before, ${time}`;
}
