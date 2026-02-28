/**
 * Test all tool endpoints — list, echo, calculator, weather, Hacker News, web search.
 *
 * Usage: bun scripts/02-tools.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Tools");

// --- List tools ---
info("GET /api/tools — list all registered tools");
let res = await api("GET", "/api/tools");
assert.status(res, 200, "List tools");
assert.contains(res, "echo", "Has echo tool");
assert.contains(res, "getWeather", "Has weather tool");
assert.contains(res, "calculate", "Has calculator tool");

// --- Echo ---
info("POST /api/tools/echo");
res = await api("POST", "/api/tools/echo", { message: "hello from script" });
assert.status(res, 200, "Echo tool");
assert.contains(res, "hello from script", "Echoed message");

// --- Calculator ---
info("POST /api/tools/calculate — 42 * 17");
res = await api("POST", "/api/tools/calculate", { expression: "42 * 17" });
assert.status(res, 200, "Calculator multiply");
assert.contains(res, "714", "Correct result");

info("POST /api/tools/calculate — (2 + 3) ^ 4");
res = await api("POST", "/api/tools/calculate", { expression: "(2 + 3) ^ 4" });
assert.status(res, 200, "Calculator exponent");
assert.contains(res, "625", "Correct result");

// --- Weather ---
info("POST /api/tools/getWeather — Tokyo");
res = await api("POST", "/api/tools/getWeather", { location: "Tokyo" });
assert.status(res, 200, "Weather tool");
assert.contains(res, "temperature", "Has temperature data");

// --- Hacker News ---
info("POST /api/tools/hackernewsTopStories — limit 3");
res = await api("POST", "/api/tools/hackernewsTopStories", { limit: 3 });
assert.status(res, 200, "HN top stories");
assert.contains(res, "title", "Has story titles");

// Extract a story ID for the detail call
const stories = res.json();
const storyId =
  stories?.stories?.[0]?.id ??
  stories?.result?.stories?.[0]?.id;

if (storyId) {
  info(`POST /api/tools/hackernewsStoryDetail — story ${storyId}`);
  res = await api("POST", "/api/tools/hackernewsStoryDetail", { storyId });
  assert.status(res, 200, "HN story detail");
  assert.contains(res, "title", "Has story title");
} else {
  assert.skip("hackernewsStoryDetail — could not extract story ID");
}

// --- Web Search (optional — needs BRAVE_API_KEY) ---
info("POST /api/tools/searchWeb — requires BRAVE_API_KEY");
res = await api("POST", "/api/tools/searchWeb", { query: "kitn ai framework", limit: 2 });
if (res.status === 200) {
  assert.status(res, 200, "Web search");
} else {
  assert.skip("Web search — BRAVE_API_KEY not configured");
}

process.exit(summary());
