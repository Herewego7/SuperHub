import { useQuery } from "@tanstack/react-query";
import { Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, Snowflake } from "lucide-react";

/**
 * The live weather for the saved location, shown next to the location field.
 *
 * This replaced a sentence explaining that a location "powers the weather
 * widget" — the widget appearing IS that explanation, and it doubles as
 * confirmation that the city actually resolved to somewhere real. Renders
 * nothing until there's real data, so a failed or unset location quietly
 * shows no chip rather than an error.
 */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  clear: Sun, clouds: Cloud, rain: CloudRain, drizzle: CloudDrizzle,
  thunderstorm: CloudLightning, snow: CloudSnow, default: Snowflake,
};

interface WeatherData {
  location: string;
  temperature: number;
  condition: string;
}

export function LocationWeatherChip({ className = "" }: { className?: string }) {
  const { data } = useQuery<WeatherData>({
    queryKey: ["/api/weather"],
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
  if (!data || typeof data.temperature !== "number") return null;
  const Icon = ICONS[(data.condition ?? "").toLowerCase()] ?? Cloud;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2 py-0.5 text-xs text-muted-foreground ${className}`}
      data-testid="location-weather-chip"
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="tabular-nums">{Math.round(data.temperature)}°</span>
      {data.location && <span className="truncate max-w-[10rem]">· {data.location}</span>}
    </span>
  );
}
