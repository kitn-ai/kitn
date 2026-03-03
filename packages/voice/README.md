# @kitnai/voice

Voice provider abstraction for kitn -- speech-to-text (STT) and text-to-speech (TTS) with pluggable providers, audio storage, and ready-made HTTP routes.

## Installation

```bash
bun add @kitnai/voice
```

Peer dependency: `zod@^4`.

## Overview

The voice package provides three layers:

1. **VoiceProvider** -- a provider-agnostic interface for transcription and speech synthesis.
2. **VoiceManager** -- a registry that holds multiple providers with a default.
3. **Plugin + Routes** -- a `KitnPlugin` that mounts voice HTTP routes (`/transcribe`, `/speak`, `/converse`, `/speakers`, `/providers`, `/audio`).

Audio storage is optional. When enabled, uploaded and generated audio can be persisted via an `AudioStore` (in-memory or file-based).

## Exports

| Export | Kind | Description |
|---|---|---|
| `VoiceProvider` | interface | Provider contract: `transcribe()`, `speak()`, `getSpeakers()` |
| `TranscribeOptions` | type | Options for transcription (language, prompt, model) |
| `TranscribeResult` | type | Transcription result (text, language, duration) |
| `SpeakOptions` | type | Options for speech synthesis (speaker, format, speed, model) |
| `VoiceSpeaker` | type | Speaker descriptor (voiceId, name) |
| `VoiceManager` | class | Registry of voice providers with default selection |
| `OpenAIVoiceProvider` | class | OpenAI-compatible provider (works with OpenAI and Groq APIs) |
| `OpenAIVoiceProviderConfig` | type | Configuration for `OpenAIVoiceProvider` |
| `AudioStore` | interface | Storage contract for audio files |
| `AudioEntry` | type | Metadata for a stored audio file (id, mimeType, size, createdAt) |
| `createMemoryAudioStore` | function | In-memory audio store (lost on restart) |
| `createFileAudioStore` | function | File-based audio store (persists to disk) |
| `createVoice` | function | Plugin factory -- returns a `KitnPlugin` with voice routes |
| `VoicePluginConfig` | type | Configuration for `createVoice()` |
| `createVoiceRoutes` | function | Low-level route factory (for advanced use) |
| `VoiceRoutesConfig` | type | Configuration for `createVoiceRoutes()` |
| `speakRequestSchema` | zod schema | Request body schema for `/speak` |
| `transcribeResponseSchema` | zod schema | Response schema for `/transcribe` |
| `speakersResponseSchema` | zod schema | Response schema for `/speakers` |
| `converseResponseHeadersSchema` | zod schema | Response headers schema for `/converse` |

## VoiceProvider Interface

Every voice provider implements this interface:

```ts
interface VoiceProvider {
  readonly name: string;
  readonly label: string;
  transcribe(audio: Blob | Buffer, options?: TranscribeOptions): Promise<TranscribeResult>;
  speak(text: string, options?: SpeakOptions): Promise<ReadableStream<Uint8Array>>;
  getSpeakers(): Promise<VoiceSpeaker[]>;
}
```

### OpenAIVoiceProvider

The built-in provider works with any OpenAI-compatible API (OpenAI, Groq, etc.):

```ts
import { OpenAIVoiceProvider } from "@kitn/voice";

const openai = new OpenAIVoiceProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  ttsModel: "tts-1",           // default: "tts-1"
  sttModel: "gpt-4o-mini-transcribe", // default: "gpt-4o-mini-transcribe"
  defaultSpeaker: "nova",      // default: "alloy"
});

// For Groq (or any OpenAI-compatible API), override baseUrl and name:
const groq = new OpenAIVoiceProvider({
  apiKey: process.env.GROQ_API_KEY!,
  baseUrl: "https://api.groq.com/openai/v1",
  name: "groq",
  label: "Groq",
  sttModel: "whisper-large-v3-turbo",
});
```

Available speakers: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`.

Supported audio formats for TTS: `mp3`, `opus`, `wav`, `aac`, `flac`.

## VoiceManager

Holds multiple providers and designates the first registered provider as the default:

```ts
import { VoiceManager, OpenAIVoiceProvider } from "@kitn/voice";

const manager = new VoiceManager();
manager.register(openaiProvider);  // becomes the default
manager.register(groqProvider);

manager.get();          // returns the default provider
manager.get("groq");    // returns the Groq provider
manager.list();         // returns all providers
manager.listNames();    // returns ["openai", "groq"]
manager.isAvailable();  // true if any provider is registered
```

## Plugin Usage

The simplest way to add voice to a kitn app is via the plugin factory:

```ts
import { createVoice, OpenAIVoiceProvider } from "@kitn/voice";

const voicePlugin = createVoice({
  providers: [
    new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  ],
  retainAudio: true,  // save uploaded audio server-side (optional)
  // audioStore: createFileAudioStore("./data"),  // defaults to in-memory
});
```

This returns a `KitnPlugin` with `name: "voice"` and `prefix: "/voice"` that mounts the following routes.

## HTTP Routes

All routes are mounted under the plugin prefix (default `/voice`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/speakers` | List available speakers from the default provider |
| `GET` | `/providers` | List all registered voice providers |
| `POST` | `/transcribe` | Transcribe audio to text (multipart form: `audio` file) |
| `POST` | `/speak` | Convert text to streaming audio (JSON body) |
| `POST` | `/converse` | Full voice loop: transcribe audio, run agent, speak response |
| `GET` | `/audio` | List saved audio entries |
| `GET` | `/audio/:id` | Retrieve a saved audio file by ID |
| `DELETE` | `/audio/:id` | Delete a saved audio file by ID |

### POST /transcribe

Accepts `multipart/form-data` with fields:

- `audio` (required) -- audio file
- `language` -- language hint
- `prompt` -- transcription prompt/context
- `retainAudio` -- `"true"` to save the audio server-side

Query parameter `?provider=groq` selects a specific provider.

### POST /speak

Accepts JSON body:

```json
{
  "text": "Hello, how can I help you?",
  "speaker": "nova",
  "format": "mp3",
  "speed": 1.0,
  "save": true
}
```

Returns streaming audio. When `save` is `true`, the audio is buffered and saved, and the response includes an `X-Audio-Id` header.

### POST /converse

Accepts `multipart/form-data` with fields:

- `audio` (required) -- audio file
- `agent` -- agent name to use (defaults to first non-orchestrator agent with tools)
- `speaker`, `format`, `speed`, `model` -- TTS options
- `conversationId` -- for conversation continuity

Returns streaming audio with response metadata in headers:

- `X-Transcription` -- URL-encoded transcription of the input audio
- `X-Response-Text` -- URL-encoded text of the agent response
- `X-Conversation-Id` -- conversation ID for follow-up calls

## AudioStore

Optional storage for audio files. Two implementations are provided:

```ts
import { createMemoryAudioStore, createFileAudioStore } from "@kitn/voice";

// In-memory (for testing/development, lost on restart)
const memStore = createMemoryAudioStore();

// File-based (persists to disk at {dataDir}/audio/)
const fileStore = createFileAudioStore("./data");
```

Both support scoped storage via an optional `scopeId` parameter on all methods, and garbage collection via `cleanupOlderThan()`.

### AudioStore Interface

```ts
interface AudioStore {
  saveAudio(buffer: Buffer | Uint8Array, mimeType: string, metadata?: Record<string, unknown>, scopeId?: string): Promise<AudioEntry>;
  getAudio(id: string, scopeId?: string): Promise<{ entry: AudioEntry; data: Buffer } | null>;
  deleteAudio(id: string, scopeId?: string): Promise<boolean>;
  listAudio(scopeId?: string): Promise<AudioEntry[]>;
  cleanupOlderThan(maxAgeMs: number, scopeId?: string): Promise<number>;
}
```

## Tests

```bash
bun test packages/voice
```

## Monorepo

This package is part of the [kitn monorepo](../../README.md).
