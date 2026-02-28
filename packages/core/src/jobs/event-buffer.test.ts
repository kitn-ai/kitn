import { describe, test, expect } from "bun:test";
import { createEventBuffer } from "./event-buffer.js";
import type { BufferedEvent } from "./event-buffer.js";

describe("EventBuffer", () => {
  test("stores and replays events", () => {
    const buffer = createEventBuffer();

    const event1: BufferedEvent = { id: "1", event: "text", data: "hello" };
    const event2: BufferedEvent = { id: "2", event: "text", data: "world" };

    buffer.push("job-1", event1);
    buffer.push("job-1", event2);

    const events = buffer.replay("job-1");
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(event1);
    expect(events[1]).toEqual(event2);
  });

  test("returns empty array for unknown job", () => {
    const buffer = createEventBuffer();

    const events = buffer.replay("nonexistent");
    expect(events).toEqual([]);
  });

  test("cleans up buffer for a job", () => {
    const buffer = createEventBuffer();

    buffer.push("job-1", { id: "1", event: "text", data: "hello" });
    buffer.push("job-2", { id: "2", event: "text", data: "world" });

    buffer.cleanup("job-1");

    // job-1 should be gone
    expect(buffer.replay("job-1")).toEqual([]);
    // job-2 should still exist
    expect(buffer.replay("job-2")).toHaveLength(1);
  });

  test("tracks whether a job has active listeners", () => {
    const buffer = createEventBuffer();

    expect(buffer.hasListeners("job-1")).toBe(false);

    const unsub = buffer.addListener("job-1", () => {});
    expect(buffer.hasListeners("job-1")).toBe(true);

    unsub();
    expect(buffer.hasListeners("job-1")).toBe(false);
  });

  test("notifies listeners on push", () => {
    const buffer = createEventBuffer();
    const received: BufferedEvent[] = [];

    buffer.addListener("job-1", (event) => {
      received.push(event);
    });

    const event: BufferedEvent = { id: "1", event: "text", data: "hello" };
    buffer.push("job-1", event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  test("does not notify listeners for different jobs", () => {
    const buffer = createEventBuffer();
    const received: BufferedEvent[] = [];

    buffer.addListener("job-1", (event) => {
      received.push(event);
    });

    buffer.push("job-2", { id: "1", event: "text", data: "hello" });

    expect(received).toHaveLength(0);
  });

  test("supports multiple listeners per job", () => {
    const buffer = createEventBuffer();
    const received1: BufferedEvent[] = [];
    const received2: BufferedEvent[] = [];

    buffer.addListener("job-1", (event) => received1.push(event));
    buffer.addListener("job-1", (event) => received2.push(event));

    buffer.push("job-1", { id: "1", event: "text", data: "hello" });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  test("cleanup removes listeners too", () => {
    const buffer = createEventBuffer();
    const received: BufferedEvent[] = [];

    buffer.addListener("job-1", (event) => received.push(event));
    expect(buffer.hasListeners("job-1")).toBe(true);

    buffer.cleanup("job-1");
    expect(buffer.hasListeners("job-1")).toBe(false);

    // Should not receive events after cleanup
    buffer.push("job-1", { id: "1", event: "text", data: "hello" });
    expect(received).toHaveLength(0);
  });
});
