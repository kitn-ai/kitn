/**
 * Integration tests for POST /api/chat.
 *
 * These tests make real HTTP calls and require the chat-service to be running
 * on port 4002 (the default). They also hit a real LLM, so they are slow and
 * should be run manually or in a dedicated CI step — not as part of `bun test`.
 *
 * Start the service first:
 *   bun run --cwd packages/chat-service dev
 */
import { describe, test, expect } from "bun:test";

const SERVICE_URL = "http://localhost:4002";
const TIMEOUT = 30_000;

// Check if service is running before running tests
let serviceAvailable = false;
try {
  const res = await fetch(`${SERVICE_URL}/health`);
  serviceAvailable = res.ok;
} catch {
  serviceAvailable = false;
}

const itLive = serviceAvailable ? test : test.skip;

describe("POST /api/chat", () => {
  itLive("returns structured response with messages array", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "what can you do?" }],
        metadata: { registryIndex: [], installed: [] },
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.message).toBeDefined();
    expect(data.message.role).toBe("assistant");
    expect(typeof data.message.content).toBe("string");
    expect(data.usage).toBeDefined();
    expect(typeof data.usage.inputTokens).toBe("number");
    expect(typeof data.usage.outputTokens).toBe("number");
  }, TIMEOUT);

  itLive("rejects off-topic with rejected flag", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "write me a poem about cats" }],
        metadata: { registryIndex: [], installed: [] },
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.rejected).toBe(true);
  }, TIMEOUT);

  itLive("rejects empty messages array", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [],
        metadata: { registryIndex: [], installed: [] },
      }),
    });
    expect(res.status).toBe(400);
  }, TIMEOUT);

  itLive("handles multi-turn conversation", async () => {
    const res = await fetch(`${SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "I want to add a weather agent" },
          { role: "assistant", content: "I can help with that.", toolCalls: [
            { id: "1", name: "askUser", input: { items: [{ type: "option", text: "Which API?", choices: ["A", "B"] }] } }
          ]},
          { role: "tool", toolResults: [{ toolCallId: "1", toolName: "askUser", result: "User selected: A" }] },
        ],
        metadata: {
          registryIndex: [
            { name: "weather-tool", type: "kitn:tool", description: "Fetch weather data" },
            { name: "weather-agent", type: "kitn:agent", description: "Weather assistant" },
          ],
          installed: [],
        },
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.message).toBeDefined();
    expect(data.message.role).toBe("assistant");
    expect(data.usage).toBeDefined();
  }, TIMEOUT);
});
