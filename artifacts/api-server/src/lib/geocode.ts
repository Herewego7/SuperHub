import { logger } from "./logger";

/**
 * Turn a city + region + country into coordinates, so weather is fetched for
 * where the family actually is.
 *
 * ⚠️ Why this exists: both places that saved a location hardcoded
 * 44.6402 / -93.1468 — Farmington, Minnesota, the author's own town — and
 * `/api/weather` reads coordinates, not the city name. So every family in the
 * app saw Minnesota's weather regardless of the city they typed (2026-09-10).
 * Adding Canada made it impossible to ignore: a family in Toronto would have
 * seen Minnesota too.
 *
 * Uses Open-Meteo's geocoding API — the same service the weather itself comes
 * from, free and with no API key to manage.
 *
 * Best-effort by design. A failure returns null and the caller keeps whatever
 * coordinates it already had: a wrong forecast is a much smaller problem than
 * a location that refuses to save because a third party is down.
 */
export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

const COUNTRY_CODES: Record<string, string> = {
  "united states": "US",
  canada: "CA",
};

export async function geocodeCity(
  city: string,
  region: string,
  country: string,
): Promise<GeocodeResult | null> {
  const name = city.trim();
  if (!name) return null;
  const countryCode = COUNTRY_CODES[country.trim().toLowerCase()];

  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search` +
      `?name=${encodeURIComponent(name)}&count=10&language=en&format=json` +
      (countryCode ? `&countryCode=${countryCode}` : "");
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { latitude: number; longitude: number; admin1?: string; country_code?: string }[];
    };
    const results = data.results ?? [];
    if (results.length === 0) return null;

    // Several cities share a name across states/provinces (there is a
    // Farmington in at least nine US states). Prefer the one whose admin1
    // matches the region the family entered; fall back to the first result,
    // which Open-Meteo already orders by population.
    const wanted = region.trim().toLowerCase();
    const match =
      results.find((r) => (r.admin1 ?? "").toLowerCase() === wanted) ??
      results.find((r) => (r.admin1 ?? "").toLowerCase().startsWith(wanted)) ??
      results[0]!;
    return { latitude: match.latitude, longitude: match.longitude };
  } catch (error) {
    logger.warn({ error, city: name, country }, "Geocoding lookup failed — keeping existing coordinates");
    return null;
  }
}
