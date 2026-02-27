# Voice Client Example

A standalone Solid.js voice interface that demonstrates speech-to-text, text-to-speech, and streamed agent conversations with a kitn server.

## What it demonstrates

- **Voice recording** -- hold-to-record via a mic button or the spacebar, captured as WebM using the MediaRecorder API.
- **Speech-to-text** -- sends recorded audio to `/api/voice/transcribe` and displays the transcript for review before sending.
- **Agent streaming** -- streams the supervisor agent response over SSE, rendering text deltas, tool calls, delegation events, and activity logs in real time.
- **Text-to-speech playback** -- synthesizes the agent reply via `/api/voice/speak`, using chunked progressive TTS with gapless Web Audio scheduling for low time-to-first-audio.
- **Configurable settings** -- speaker voice and STT provider are selectable in a settings panel and persisted to localStorage.

## Prerequisites

A running kitn API server with the voice plugin enabled. The server must expose these endpoints:

- `POST /api/voice/transcribe`
- `POST /api/voice/speak`
- `GET  /api/voice/speakers`
- `GET  /api/voice/providers`
- `POST /api/agents/supervisor?format=sse`

By default the client expects the server at `http://localhost:3000`.

## Setup

```bash
cd examples/voice
bun install
bun run dev
```

The Vite dev server starts on **port 5173** (the Vite default). Open `http://localhost:5173` in a browser.

### Environment variables (optional)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Base URL of the kitn API server |
| `VITE_API_KEY` | `demo` | API key sent as the `X-API-Key` header |

## Tech stack

- [Solid.js](https://www.solidjs.com/) 1.x -- reactive UI
- [Tailwind CSS](https://tailwindcss.com/) 4 -- styling
- [Vite](https://vite.dev/) 7 with `vite-plugin-solid` -- dev server and build
- [t3-env](https://env.t3.gg/) + Zod -- environment variable validation

## How it connects to the API

In development, the Vite config proxies all `/api` requests to `http://localhost:3000`:

```ts
// vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
  },
},
```

This avoids CORS issues and lets the client use relative fetch URLs. For production builds, set `VITE_API_URL` to the full server origin.

## Note on duplicate audio utilities

This example ships its own SSE parser (`lib/sse-parser.ts`), chunked TTS helper (`lib/chunked-speak.ts`), and audio recorder/player hooks (`lib/useAudioRecorder.ts`, `lib/useAudioPlayer.ts`). Similar utilities exist in the `@kitn/client` package. This duplication is intentional for now so the example stays self-contained, but it will be refactored to share code with `@kitn/client` in a future release.

## Monorepo

This example lives inside the kitn monorepo. See the [root README](../../README.md) for an overview of all packages and examples.
