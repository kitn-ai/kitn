/**
 * SSE parser tests.
 * Run with: bun test packages/ai-client/test/sse-parser.test.ts
 */
import { describe, test, expect } from "bun:test";
import { parseSseStream } from "../src/sse-parser.ts";
import type { SseEvent } from "../src/sse-parser.ts";

/** Create a mock Response from raw SSE text. */
function mockResponse(raw: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(raw));
      controller.close();
    },
  });
  return new Response(stream);
}

/** Create a mock Response that delivers data in multiple chunks. */
function mockChunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

/** Collect all events from the async generator. */
async function collectEvents(response: Response): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of parseSseStream(response)) {
    events.push(event);
  }
  return events;
}

describe("parseSseStream", () => {
  test("parses a single event", async () => {
    const raw = "event: text-delta\ndata: hello\n\n";
    const events = await collectEvents(mockResponse(raw));

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("text-delta");
    expect(events[0].data).toBe("hello");
  });

  test("parses multiple events", async () => {
    const raw = [
      "event: text-delta\ndata: hello\n\n",
      "event: text-delta\ndata: world\n\n",
      "event: done\ndata: {}\n\n",
    ].join("");

    const events = await collectEvents(mockResponse(raw));

    expect(events).toHaveLength(3);
    expect(events[0].data).toBe("hello");
    expect(events[1].data).toBe("world");
    expect(events[2].event).toBe("done");
  });

  test("parses event with id field", async () => {
    const raw = "event: message\nid: 42\ndata: test\n\n";
    const events = await collectEvents(mockResponse(raw));

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message");
    expect(events[0].id).toBe("42");
    expect(events[0].data).toBe("test");
  });

  test("parses JSON data payloads", async () => {
    const raw = 'event: tool-call\ndata: {"name":"search","args":{"q":"test"}}\n\n';
    const events = await collectEvents(mockResponse(raw));

    expect(events).toHaveLength(1);
    const parsed = JSON.parse(events[0].data);
    expect(parsed.name).toBe("search");
    expect(parsed.args.q).toBe("test");
  });

  test("ignores incomplete events (no data)", async () => {
    const raw = "event: orphan\n\nevent: complete\ndata: yes\n\n";
    const events = await collectEvents(mockResponse(raw));

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("complete");
  });

  test("ignores incomplete events (no event name)", async () => {
    const raw = "data: orphan\n\nevent: complete\ndata: yes\n\n";
    const events = await collectEvents(mockResponse(raw));

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("complete");
  });

  test("handles chunked delivery splitting mid-line", async () => {
    const events = await collectEvents(
      mockChunkedResponse([
        "event: text-de",
        "lta\ndata: hel",
        "lo\n\n",
      ]),
    );

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("text-delta");
    expect(events[0].data).toBe("hello");
  });

  test("handles chunked delivery splitting between events", async () => {
    const events = await collectEvents(
      mockChunkedResponse([
        "event: first\ndata: one\n\nevent: sec",
        "ond\ndata: two\n\n",
      ]),
    );

    expect(events).toHaveLength(2);
    expect(events[0].data).toBe("one");
    expect(events[1].data).toBe("two");
  });

  test("flushes trailing event when final newline present but no blank line", async () => {
    const raw = "event: final\ndata: trailing\n";
    const events = await collectEvents(mockResponse(raw));

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("final");
    expect(events[0].data).toBe("trailing");
  });

  test("drops unterminated event with no trailing newline", async () => {
    const raw = "event: final\ndata: trailing";
    const events = await collectEvents(mockResponse(raw));

    // Without a trailing newline, the data line stays in the buffer
    // and is never parsed — matches SSE spec behavior
    expect(events).toHaveLength(0);
  });

  test("returns empty array for empty response", async () => {
    const events = await collectEvents(mockResponse(""));
    expect(events).toHaveLength(0);
  });

  test("trims whitespace from event and data values", async () => {
    const raw = "event:  text-delta  \ndata:  hello  \n\n";
    const events = await collectEvents(mockResponse(raw));

    expect(events[0].event).toBe("text-delta");
    expect(events[0].data).toBe("hello");
  });
});
