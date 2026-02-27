# @kitnai/client

Browser utilities for streaming AI agent responses and handling audio I/O.

## Installation

```bash
bun add @kitnai/client
```

## Exports

| Export | Description |
|---|---|
| `parseSseStream` | Async generator that parses SSE events from a `fetch` `Response`. Works with POST endpoints (unlike `EventSource`, which is GET-only). |
| `SseEvent` | TypeScript interface for parsed SSE events (`event`, `data`, optional `id`). |
| `splitIntoChunks` | Splits text into sentence chunks with exponential growth (1, 2, 3, 5, 8 sentences) for progressive TTS playback. |
| `chunkedSpeak` | Orchestrates pipelined TTS synthesis and gapless audio scheduling with stop support. |
| `AudioScheduler` | Framework-agnostic Web Audio API scheduler for gapless playback of audio chunks. |
| `AudioRecorder` | Framework-agnostic microphone recorder using MediaRecorder with callback-based state. |

## Usage

### parseSseStream

Parse server-sent events from any `fetch` response. Each yielded object has `event`, `data`, and an optional `id`.

```ts
import { parseSseStream } from "@kitn/client";

const response = await fetch("/api/agent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Hello" }),
});

for await (const event of parseSseStream(response)) {
  switch (event.event) {
    case "text-delta":
      process.stdout.write(event.data);
      break;
    case "tool-call":
      console.log("Tool call:", JSON.parse(event.data));
      break;
    case "done":
      console.log("Stream complete");
      break;
  }
}
```

### chunkedSpeak

Splits text into progressively larger chunks, fires all TTS synthesis requests in parallel (pipelined), and schedules each result for gapless playback as it resolves. The first chunk is a single sentence for fast time-to-first-audio.

```ts
import { chunkedSpeak, AudioScheduler } from "@kitn/client";

const scheduler = new AudioScheduler();
let stopped = false;

await chunkedSpeak(
  "First sentence arrives fast. Then chunks grow larger. This keeps latency low while reducing total API calls.",
  async (chunk) => {
    // Call your TTS API for each chunk
    const res = await fetch("/api/tts", {
      method: "POST",
      body: JSON.stringify({ text: chunk }),
    });
    return await res.blob();
  },
  (blob) => scheduler.schedule(blob),
  () => scheduler.waitForEnd(),
  () => stopped,
);
```

### AudioScheduler

Manages Web Audio API nodes for gapless playback of sequential audio blobs. Trims leading silence from each chunk to eliminate gaps between segments.

```ts
import { AudioScheduler } from "@kitn/client";

const scheduler = new AudioScheduler();

// Schedule blobs for back-to-back playback
await scheduler.schedule(audioBlob1);
await scheduler.schedule(audioBlob2);

// Adjust volume (0-1)
scheduler.setVolume(0.8);

// Wait for all audio to finish
await scheduler.waitForEnd();

// Or stop immediately
scheduler.stop();
```

### AudioRecorder

Wraps the MediaRecorder API with start/stop/cancel lifecycle and an optional state-change callback. Framework-agnostic -- wire `onStateChange` to your UI framework's reactivity system.

```ts
import { AudioRecorder } from "@kitn/client";

const recorder = new AudioRecorder({
  mimeType: "audio/webm",
  onStateChange: (recording) => {
    console.log(recording ? "Recording..." : "Stopped");
  },
});

// Start recording (requests mic permission on first call)
await recorder.start();

// Stop and get the audio blob
const blob = await recorder.stop();

// Or cancel without returning data
recorder.cancel();

// Check state
console.log(recorder.recording); // boolean
```

## Tests

```bash
bun test packages/client
```

## Monorepo

This package is part of the [kitn monorepo](../../README.md).
