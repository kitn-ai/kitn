import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

function describeWeatherCode(code: number): string {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 55) return "Drizzle";
  if (code >= 61 && code <= 65) return "Rain";
  if (code >= 71 && code <= 75) return "Snow";
  if (code === 77) return "Snow grains";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code >= 96 && code <= 99) return "Thunderstorm with hail";
  return "Unknown";
}

function toFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

export const weatherTool = tool({
  description:
    "Get current weather information for a location. Returns temperature, humidity, wind speed, and conditions.",
  inputSchema: z.object({
    location: z
      .string()
      .describe("City name or location (e.g. 'Tokyo', 'New York')"),
  }),
  execute: async ({ location }) => {
    const geoRes = await fetch(
      `${GEOCODING_URL}?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
    );
    if (!geoRes.ok) {
      throw new Error(`Geocoding failed: ${geoRes.statusText}`);
    }
    const geoData = await geoRes.json();
    const place = geoData.results?.[0];
    if (!place) {
      throw new Error(`Location not found: "${location}"`);
    }

    const { latitude, longitude, name, country } = place;

    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: [
        "temperature_2m",
        "apparent_temperature",
        "relative_humidity_2m",
        "weather_code",
        "wind_speed_10m",
        "wind_direction_10m",
        "visibility",
        "uv_index",
        "precipitation",
      ].join(","),
      wind_speed_unit: "kmh",
      timezone: "auto",
    });

    const weatherRes = await fetch(`${WEATHER_URL}?${params}`);
    if (!weatherRes.ok) {
      throw new Error(`Weather API failed: ${weatherRes.statusText}`);
    }
    const weatherData = await weatherRes.json();
    const c = weatherData.current;

    const tempC = c.temperature_2m;
    const feelsLikeC = c.apparent_temperature;
    const windKmph = c.wind_speed_10m;

    return {
      location: `${name}, ${country}`,
      coordinates: { latitude, longitude },
      temperature: {
        celsius: tempC,
        fahrenheit: toFahrenheit(tempC),
      },
      feelsLike: {
        celsius: feelsLikeC,
        fahrenheit: toFahrenheit(feelsLikeC),
      },
      humidity: c.relative_humidity_2m,
      description: describeWeatherCode(c.weather_code),
      weatherCode: c.weather_code,
      windSpeed: {
        kmph: windKmph,
        mph: Math.round(windKmph / 1.609),
      },
      windDirection: c.wind_direction_10m,
      visibility: c.visibility,
      uvIndex: c.uv_index,
      precipitation: c.precipitation,
      timezone: weatherData.timezone,
    };
  },
});

registerTool({
  name: "weather-tool",
  description:
    "Get current weather information for a location. Returns temperature, humidity, wind speed, and conditions.",
  inputSchema: z.object({
    location: z
      .string()
      .describe("City name or location (e.g. 'Tokyo', 'New York')"),
  }),
  tool: weatherTool,
});
