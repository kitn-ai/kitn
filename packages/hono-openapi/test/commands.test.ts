import { describe, test, expect } from "bun:test";
import { createAIPlugin } from "../src/plugin.js";

function createTestPlugin() {
  return createAIPlugin({
    model: () => ({ /* mock */ } as any),
  });
}

describe("command routes", () => {
  test("GET /commands returns empty list initially", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();
    const res = await plugin.router.request("/commands");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commands).toEqual([]);
  });

  test("POST /commands creates a command", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();

    const res = await plugin.router.request("/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "summarize",
        description: "Summarize text",
        system: "You summarize things",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("summarize");
  });

  test("GET /commands/:name returns a specific command", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();

    await plugin.router.request("/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-cmd", description: "D", system: "S" }),
    });

    const res = await plugin.router.request("/commands/test-cmd");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("test-cmd");
  });

  test("GET /commands/:name returns 404 for missing", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();
    const res = await plugin.router.request("/commands/missing");
    expect(res.status).toBe(404);
  });

  test("POST /commands/:name/run returns 404 for missing command", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();
    const res = await plugin.router.request("/commands/missing/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /commands/:name removes command", async () => {
    const plugin = createTestPlugin();
    await plugin.initialize();

    await plugin.router.request("/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "to-delete", description: "D", system: "S" }),
    });

    const del = await plugin.router.request("/commands/to-delete", { method: "DELETE" });
    expect(del.status).toBe(200);

    const get = await plugin.router.request("/commands/to-delete");
    expect(get.status).toBe(404);
  });
});
