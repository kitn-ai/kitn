import { describe, test, expect, afterEach } from "bun:test";

describe("WebSocket server", () => {
  let server: any;
  afterEach(() => server?.stop());

  test("WebSocket connection can be established at /ws", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      onMessage: async (_sid: string, text: string) => ({ text: `Echo: ${text}` }),
    });
    const addr = server.start();

    const ws = new WebSocket(`ws://localhost:${addr.port}/ws`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });
    expect(opened).toBe(true);
    ws.close();
  });

  test("client sends JSON message and receives JSON response", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      onMessage: async (_sid: string, text: string) => ({
        text: `Echo: ${text}`,
        toolCalls: [{ name: "test-tool", input: { x: 1 }, result: "ok" }],
      }),
    });
    const addr = server.start();

    const ws = new WebSocket(`ws://localhost:${addr.port}/ws`);
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (event) => {
        resolve(JSON.parse(event.data as string));
      };
      ws.send(JSON.stringify({ sessionId: "ws-test-1", text: "Hello" }));
    });

    expect(response.text).toBe("Echo: Hello");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe("test-tool");
    ws.close();
  });

  test("auth token is checked on WebSocket upgrade — rejects wrong token", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      authToken: "secret-token",
      onMessage: async (_sid: string, text: string) => ({ text }),
    });
    const addr = server.start();

    // Wrong token — should be rejected
    const ws = new WebSocket(`ws://localhost:${addr.port}/ws?token=wrong`);
    const result = await new Promise<string>((resolve) => {
      ws.onopen = () => resolve("opened");
      ws.onclose = () => resolve("closed");
      ws.onerror = () => resolve("error");
      setTimeout(() => resolve("timeout"), 2000);
    });
    // Should not open successfully
    expect(result).not.toBe("opened");
  });

  test("auth token is checked on WebSocket upgrade — rejects missing token", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      authToken: "secret-token",
      onMessage: async (_sid: string, text: string) => ({ text }),
    });
    const addr = server.start();

    // No token — should be rejected
    const ws = new WebSocket(`ws://localhost:${addr.port}/ws`);
    const result = await new Promise<string>((resolve) => {
      ws.onopen = () => resolve("opened");
      ws.onclose = () => resolve("closed");
      ws.onerror = () => resolve("error");
      setTimeout(() => resolve("timeout"), 2000);
    });
    expect(result).not.toBe("opened");
  });

  test("auth token is checked on WebSocket upgrade — accepts correct token", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      authToken: "secret-token",
      onMessage: async (_sid: string, text: string) => ({ text: `Echo: ${text}` }),
    });
    const addr = server.start();

    const ws = new WebSocket(`ws://localhost:${addr.port}/ws?token=secret-token`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      ws.onclose = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });
    expect(opened).toBe(true);
    ws.close();
  });

  test("WebSocket without auth token config allows all connections", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      onMessage: async (_sid: string, text: string) => ({ text: `Echo: ${text}` }),
    });
    const addr = server.start();

    const ws = new WebSocket(`ws://localhost:${addr.port}/ws`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });
    expect(opened).toBe(true);
    ws.close();
  });

  test("invalid JSON message returns error response", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      onMessage: async (_sid: string, text: string) => ({ text }),
    });
    const addr = server.start();

    const ws = new WebSocket(`ws://localhost:${addr.port}/ws`);
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (event) => {
        resolve(JSON.parse(event.data as string));
      };
      ws.send("not-valid-json");
    });

    expect(response.error).toBeDefined();
    ws.close();
  });

  test("message without required fields returns error", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      onMessage: async (_sid: string, text: string) => ({ text }),
    });
    const addr = server.start();

    const ws = new WebSocket(`ws://localhost:${addr.port}/ws`);
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (event) => {
        resolve(JSON.parse(event.data as string));
      };
      ws.send(JSON.stringify({ sessionId: "s1" })); // missing text
    });

    expect(response.error).toBeDefined();
    ws.close();
  });

  test("no message handler returns error", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 }); // no onMessage
    const addr = server.start();

    const ws = new WebSocket(`ws://localhost:${addr.port}/ws`);
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (event) => {
        resolve(JSON.parse(event.data as string));
      };
      ws.send(JSON.stringify({ sessionId: "s1", text: "hello" }));
    });

    expect(response.error).toBeDefined();
    ws.close();
  });
});
