export function slipSender(description: string | null | undefined): string | null {
  const match = description?.match(/^From: (\S+)\n/);
  return match?.[1] ?? null;
}

export function slipQuote(description: string | null | undefined): string {
  if (!description) return "";
  return description.replace(/^From: \S+\n/, "");
}

export function openEmailHref(shareOriginals: boolean, sender: string | null): string | null {
  if (!shareOriginals || !sender) return null;
  return `mailto:${sender}`;
}

export function suggestedSchool(text: string): string | null {
  const match = text.match(/\b([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,4}\s+(?:School|Academy|Elementary|Middle|High))\b/);
  return match?.[1] ?? null;
}
