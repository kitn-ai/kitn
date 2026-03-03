import { describe, test, expect, afterEach } from "bun:test";

describe("HTTP server", () => {
  let server: any;
  afterEach(() => server?.stop());

  test("health endpoint returns 200", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("rejects unauthenticated /api requests when token set", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0, authToken: "secret" });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/status`);
    expect(res.status).toBe(401);
  });

  test("accepts authenticated requests", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      authToken: "secret",
      getStatus: () => ({ version: "0.1.0" }),
    });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/status`, {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe("0.1.0");
  });

  test("POST /api/message returns response", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      onMessage: async (sid: string, text: string) => ({ text: `Echo: ${text}`, toolCalls: [] }),
    });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", text: "Hello" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Echo: Hello");
  });

  test("/api routes without auth token require no authentication", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      getStatus: () => ({ version: "0.1.0" }),
    });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/status`);
    expect(res.status).toBe(200);
  });

  test("POST /api/message returns 400 for missing body fields", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    expect(res.status).toBe(400);
  });

  test("unknown route returns 404", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/nonexistent`);
    expect(res.status).toBe(404);
  });

  test("GET /api/stream returns SSE headers", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 });
    const addr = server.start();
    const controller = new AbortController();
    const res = await fetch(`http://localhost:${addr.port}/api/stream?sessionId=s1`, {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    controller.abort();
  });

  test("GET /api/stream returns 400 without sessionId", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/stream`);
    expect(res.status).toBe(400);
  });

  test("wrong auth token returns 401", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0, authToken: "secret" });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/status`, {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });
});
