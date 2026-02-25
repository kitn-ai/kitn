import { describe, test, expect } from "bun:test";
import { createSSEStream } from "../src/streaming/sse-writer.js";

describe("createSSEStream", () => {
  test("returns a Response with correct headers", async () => {
    const response = createSSEStream(async () => {});
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });

  test("writes SSE-formatted events", async () => {
    const response = createSSEStream(async (writer) => {
      await writer.writeSSE({ event: "test", data: '{"hello":"world"}', id: "1" });
    });
    const text = await response.text();
    expect(text).toContain("id: 1");
    expect(text).toContain("event: test");
    expect(text).toContain('data: {"hello":"world"}');
  });

  test("writes multiple events in order", async () => {
    const response = createSSEStream(async (writer) => {
      await writer.writeSSE({ event: "a", data: "first" });
      await writer.writeSSE({ event: "b", data: "second" });
    });
    const text = await response.text();
    const aIndex = text.indexOf("event: a");
    const bIndex = text.indexOf("event: b");
    expect(aIndex).toBeLessThan(bIndex);
  });

  test("omits id field when not provided", async () => {
    const response = createSSEStream(async (writer) => {
      await writer.writeSSE({ event: "test", data: "no-id" });
    });
    const text = await response.text();
    expect(text).not.toContain("id:");
    expect(text).toContain("event: test");
    expect(text).toContain("data: no-id");
  });

  test("closes stream when handler completes", async () => {
    const response = createSSEStream(async (writer) => {
      await writer.writeSSE({ event: "done", data: "ok" });
    });
    // Should resolve without hanging
    const text = await response.text();
    expect(text).toContain("event: done");
  });

  test("closes stream on abort signal", async () => {
    const controller = new AbortController();
    const response = createSSEStream(async (writer) => {
      await writer.writeSSE({ event: "before", data: "ok" });
      // Abort mid-stream
      controller.abort();
      // This write should silently fail
      await writer.writeSSE({ event: "after", data: "should-not-appear" });
    }, controller.signal);
    const text = await response.text();
    expect(text).toContain("event: before");
  });
});
