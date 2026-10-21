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

export type ForecastDay = { date: string; high: number; low: number; condition: string; rainChance?: number | null };

/** Open-Meteo's 7-day forecast for a spot, with each day's chance of rain. */
export function forecastUrl(latitude: number | string, longitude: number | string, unit: TemperatureUnit): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max&timezone=auto&temperature_unit=${unit}&forecast_days=7`;
}

type OpenMeteoDaily = { daily?: { time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; weathercode?: number[]; precipitation_probability_max?: (number | null)[] } };

export function forecastDays(raw: unknown): ForecastDay[] {
  const data = (raw ?? {}) as OpenMeteoDaily;
  return (data.daily?.time ?? []).map((date, index) => {
    const chance = data.daily?.precipitation_probability_max?.[index];
    return {
      date,
      high: Math.round(data.daily?.temperature_2m_max?.[index] ?? 0),
      low: Math.round(data.daily?.temperature_2m_min?.[index] ?? 0),
      condition: conditionText(data.daily?.weathercode?.[index] ?? -1),
      rainChance: typeof chance === "number" ? Math.round(chance) : null,
    };
  });
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * One forecast day as chat reads it: the weekday, the daytime high and the
 * overnight low by name, and the chance of rain. A bare "Rain, high 72, low 54"
 * came back as "rain tomorrow and a drop into the 50s" (2026-10-21): the
 * condition is the day's worst moment, and the low is overnight.
 */
export function forecastLine(day: ForecastDay): string {
  const [year, month, date] = day.date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()] ?? "";
  const rain = day.rainChance != null ? `, ${day.rainChance}% chance of rain` : "";
  return `${weekday} ${day.date}: ${day.condition} at some point, daytime high ${day.high}, overnight low ${day.low}${rain}`;
}

export async function forecastForPlace(place: string, date: string, unit: TemperatureUnit = "fahrenheit"): Promise<Record<string, unknown>> {
  const hit = await geocodePlace(place);
  if (!hit) return { error: "I couldn't find that place." };
  try {
    const res = await fetch(forecastUrl(hit.latitude, hit.longitude, unit), { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { error: "No forecast for that place.", place: hit.label };
    const row = forecastDays(await res.json()).find((day) => day.date === date);
    // Not another day's weather: a date past the 7-day forecast has none.
    if (!row) return { error: "No forecast for that day yet.", place: hit.label };
    return { summary: forecastLine(row), ...row, place: hit.label };
  } catch {
    return { error: "No forecast for that place.", place: hit.label };
  }
}
