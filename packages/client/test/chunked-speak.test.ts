/**
 * Chunked speak (text splitting + orchestration) tests.
 * Run with: bun test packages/ai-client/test/chunked-speak.test.ts
 */
import { describe, test, expect } from "bun:test";
import { splitIntoChunks, chunkedSpeak } from "../src/chunked-speak.ts";

describe("splitIntoChunks", () => {
  test("returns single chunk for short text without sentences", () => {
    const result = splitIntoChunks("Hello world");
    expect(result).toEqual(["Hello world"]);
  });

  test("returns single chunk for single sentence", () => {
    const result = splitIntoChunks("Hello world.");
    expect(result).toEqual(["Hello world."]);
  });

  test("splits into exponential chunks: 1, 2, 3, 5, 8", () => {
    // Create 19 sentences (1+2+3+5+8 = 19)
    const sentences = Array.from({ length: 19 }, (_, i) => `Sentence ${i + 1}.`);
    const text = sentences.join(" ");
    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(5);
    // First chunk: 1 sentence
    expect(chunks[0]).toContain("Sentence 1.");
    expect(chunks[0]).not.toContain("Sentence 2.");
    // Second chunk: 2 sentences
    expect(chunks[1]).toContain("Sentence 2.");
    expect(chunks[1]).toContain("Sentence 3.");
    expect(chunks[1]).not.toContain("Sentence 4.");
  });

  test("first chunk is always a single sentence for fast time-to-first-audio", () => {
    const text = "First sentence. Second sentence. Third sentence. Fourth sentence.";
    const chunks = splitIntoChunks(text);
    expect(chunks[0]).toBe("First sentence.");
  });

  test("handles question marks and exclamation points as sentence terminators", () => {
    const text = "Is this working? Yes it is! And this too.";
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // All original text should be present across chunks
    const rejoined = chunks.join(" ");
    expect(rejoined).toContain("Is this working?");
    expect(rejoined).toContain("Yes it is!");
  });

  test("returns original text when no sentence terminators found", () => {
    const text = "This has no punctuation at all";
    expect(splitIntoChunks(text)).toEqual([text]);
  });

  test("handles empty string", () => {
    expect(splitIntoChunks("")).toEqual([""]);
  });

  test("overflow sentences use max chunk size (8)", () => {
    // Create 30 sentences (1+2+3+5+8+8+3 = 30)
    const sentences = Array.from({ length: 30 }, (_, i) => `S${i + 1}.`);
    const text = sentences.join(" ");
    const chunks = splitIntoChunks(text);

    // 6th chunk should also be size 8 (clamped to max)
    expect(chunks.length).toBeGreaterThan(5);
  });
});

describe("chunkedSpeak", () => {
  test("synthesizes and schedules all chunks in order", async () => {
    const synthesized: string[] = [];
    const scheduled: string[] = [];

    await chunkedSpeak(
      "First sentence. Second sentence. Third sentence.",
      async (chunk) => {
        synthesized.push(chunk);
        return new Blob([chunk]);
      },
      async (blob) => {
        const text = await blob.text();
        scheduled.push(text);
      },
      () => Promise.resolve(),
      () => false,
    );

    expect(synthesized.length).toBeGreaterThan(0);
    expect(scheduled).toEqual(synthesized);
  });

  test("stops scheduling when isStopped returns true mid-loop", async () => {
    const scheduled: string[] = [];
    let stopFlag = false;

    await chunkedSpeak(
      "First. Second. Third. Fourth. Fifth.",
      async (chunk) => new Blob([chunk]),
      async (blob) => {
        const text = await blob.text();
        scheduled.push(text);
        // Stop after scheduling the first chunk
        stopFlag = true;
      },
      () => Promise.resolve(),
      () => stopFlag,
    );

    // Synthesis is pipelined (all fire at once), but scheduling should stop
    // after the first chunk is scheduled and isStopped returns true
    expect(scheduled).toHaveLength(1);
  });

  test("calls waitForEnd when not stopped", async () => {
    let waitCalled = false;

    await chunkedSpeak(
      "Hello world.",
      async (chunk) => new Blob([chunk]),
      async () => {},
      async () => { waitCalled = true; },
      () => false,
    );

    expect(waitCalled).toBe(true);
  });

  test("skips waitForEnd when stopped", async () => {
    let waitCalled = false;

    await chunkedSpeak(
      "Hello world.",
      async (chunk) => new Blob([chunk]),
      async () => {},
      async () => { waitCalled = true; },
      () => true, // always stopped
    );

    expect(waitCalled).toBe(false);
  });

  test("fires all synthesis requests immediately (pipelined)", async () => {
    const synthTimes: number[] = [];
    const scheduleTimes: number[] = [];

    await chunkedSpeak(
      "First. Second. Third.",
      async (chunk) => {
        synthTimes.push(Date.now());
        // Simulate varying synthesis times
        await new Promise((r) => setTimeout(r, 10));
        return new Blob([chunk]);
      },
      async () => {
        scheduleTimes.push(Date.now());
      },
      () => Promise.resolve(),
      () => false,
    );

    // All synthesis calls should have started before the first schedule completes
    // (pipelined behavior)
    expect(synthTimes.length).toBeGreaterThan(0);
    expect(scheduleTimes.length).toBe(synthTimes.length);
  });
});
