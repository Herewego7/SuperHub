import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Cloud, Sun, CloudRain, Snowflake, CloudDrizzle } from "lucide-react";

interface WeatherData {
  location: string;
  temperature: number;
  high: number;
  low: number;
  condition: string;
  description: string;
}

const WEATHER_ICONS = {
  'clear': Sun,
  'clouds': Cloud,
  'rain': CloudRain,
  'drizzle': CloudDrizzle,
  'snow': Snowflake,
  'default': Cloud
};

export function WeatherWidget() {
  const { user } = useAuth();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const { data: weatherData, isLoading } = useQuery<WeatherData>({
    queryKey: ["/api/weather"],
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const progress = (() => {
    if (!weatherData) return 0.5;
    const { temperature, high, low } = weatherData;
    const range = high - low;
    if (range === 0) return 0.5;
    return Math.max(0, Math.min(1, (temperature - low) / range));
  })();

  const getWeatherIcon = () => {
    if (!weatherData) return WEATHER_ICONS.default;
    const condition = weatherData.condition.toLowerCase();
    return WEATHER_ICONS[condition as keyof typeof WEATHER_ICONS] || WEATHER_ICONS.default;
  };

  const WeatherIcon = getWeatherIcon();

  const formatDate = (date: Date) =>
    date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

  const formatDateShort = (date: Date) =>
    date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

  const formatTime = (date: Date) =>
    date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  return (
    <div className="bg-card border-b border-black/[0.06] shadow-sm">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2 sm:py-3">
        {/*
          Layout strategy
          ──────────────
          Mobile  (<sm): two columns — [time + short date] | [weather summary].
                         No absolute-positioned title; no SVG gauge.
          Desktop (sm+): three columns — [time + date] | [title] | [weather + gauge].
                         Title is in normal flow (no absolute), centered via flex.
        */}
        <div className="flex items-center justify-between gap-2">

          {/* Left: time + date */}

          <div className="flex flex-col min-w-0">
            <div className="text-base sm:text-lg font-medium text-foreground leading-tight" data-testid="current-time">
              {formatTime(currentTime)}
            </div>
            {/* Short date on mobile, full date on desktop */}
            <div className="text-xs sm:text-sm text-muted-foreground truncate" data-testid="current-date">
              <span className="sm:hidden">{formatDateShort(currentTime)}</span>
              <span className="hidden sm:inline">{formatDate(currentTime)}</span>
            </div>
          </div>

          {/* Center: app title — hidden on mobile, visible on sm+ */}
          <div className="flex flex-col items-center flex-1 leading-snug">
            {(user?.displayName || user?.firstName) && (
              <span className="text-xs text-muted-foreground tracking-wide uppercase font-medium">
                {user.displayName || user.firstName}
              </span>
            )}
            <span className="text-xl font-bold text-foreground tracking-wide">SuperHub</span>
          </div>

          {/* Right: weather */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="w-5 h-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
                <span className="text-xs sm:text-sm hidden sm:inline">Loading weather…</span>
              </div>
            ) : weatherData ? (
              <>
                {/* Icon + gauge, with the temperature centered inside the
                    gauge itself (no separate location/city-state text —
                    that's not needed here). */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <WeatherIcon className="w-5 h-5 sm:w-6 sm:h-6 text-primary flex-shrink-0" />

                  {/* Compact gauge for mobile — no low/high labels (no
                      spare vertical space for them at this size). */}
                  <div className="relative w-12 sm:hidden">
                    <svg width="48" height="36" viewBox="0 0 48 36">
                      <path
                        d="M 6 27 A 18 18 0 0 1 42 27"
                        stroke="rgb(229 231 235)"
                        strokeWidth="2.5"
                        fill="none"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 6 27 A 18 18 0 0 1 42 27"
                        stroke="rgb(59 130 246)"
                        strokeWidth="2.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${56.5 * progress} 56.5`}
                        className="transition-all duration-1000 ease-out"
                      />
                      <circle
                        cx={24 + 18 * Math.cos(Math.PI - progress * Math.PI)}
                        cy={27 - 18 * Math.sin(Math.PI - progress * Math.PI)}
                        r="2"
                        fill="rgb(59 130 246)"
                        className="transition-all duration-1000 ease-out"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-end justify-center pb-0.5">
                      <span className="text-sm font-semibold text-foreground leading-none" data-testid="current-temp">
                        {Math.round(weatherData.temperature)}°
                      </span>
                    </div>
                  </div>

                  {/* SVG temperature gauge — desktop only */}
                  <div className="relative w-20 hidden sm:block">
                    <svg width="80" height="60" viewBox="0 0 80 60">
                      <path
                        d="M 10 45 A 30 30 0 0 1 70 45"
                        stroke="rgb(229 231 235)"
                        strokeWidth="4"
                        fill="none"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 10 45 A 30 30 0 0 1 70 45"
                        stroke="rgb(59 130 246)"
                        strokeWidth="4"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${94.2 * progress} 94.2`}
                        className="transition-all duration-1000 ease-out"
                      />
                      <circle
                        cx={40 + 30 * Math.cos(Math.PI - progress * Math.PI)}
                        cy={45 - 30 * Math.sin(Math.PI - progress * Math.PI)}
                        r="3"
                        fill="rgb(59 130 246)"
                        className="transition-all duration-1000 ease-out"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-end justify-center pb-1.5">
                      <span className="text-lg font-semibold text-foreground leading-none" data-testid="current-temp">
                        {Math.round(weatherData.temperature)}°F
                      </span>
                    </div>
                    <div className="absolute -bottom-2 left-0 w-full flex justify-between text-xs text-muted-foreground px-0">
                      <span data-testid="temp-low" className="translate-x-1">{Math.round(weatherData.low)}°</span>
                      <span data-testid="temp-high" className="translate-x-1">{Math.round(weatherData.high)}°</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-xs sm:text-sm text-muted-foreground">No weather</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
