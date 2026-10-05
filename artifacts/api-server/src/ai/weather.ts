/**
 * Forecast for a city the person named. Home weather stays on the chat snapshot.
 * The label is the city the lookup actually used, so a shared name is not silent.
 */
import { geocodePlace } from "../lib/geocode";

export type TemperatureUnit = "fahrenheit" | "celsius";

/** Open-Meteo weather codes, named the way a parent would say them. */
export function conditionText(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 55) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  if (code <= 99) return "Thunderstorms";
  return "Cloudy";
}

export async function forecastForPlace(place: string, date: string, unit: TemperatureUnit = "fahrenheit"): Promise<Record<string, unknown>> {
  const hit = await geocodePlace(place);
  if (!hit) return { error: "I couldn't find that place." };
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&temperature_unit=${unit}&forecast_days=7`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { error: "No forecast for that place.", place: hit.label };
    const data = await res.json() as { daily?: { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; weathercode?: number[] } };
    const days = (data.daily?.time ?? []).map((day, index) => ({
      date: day,
      high: Math.round(data.daily?.temperature_2m_max?.[index] ?? 0),
      low: Math.round(data.daily?.temperature_2m_min?.[index] ?? 0),
      condition: conditionText(data.daily?.weathercode?.[index] ?? -1),
    }));
    const row = days.find((day) => day.date === date) ?? days[0];
    if (!row) return { error: "No forecast for that day yet.", place: hit.label };
    return { ...row, place: hit.label };
  } catch {
    return { error: "No forecast for that place.", place: hit.label };
  }
}
