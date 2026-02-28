// Plugin factory
export { createVoice } from "./plugin.js";
export type { VoicePluginConfig } from "./plugin.js";

// Providers
export type { VoiceProvider, TranscribeOptions, TranscribeResult, SpeakOptions, VoiceSpeaker } from "./voice-provider.js";
export { VoiceManager } from "./voice-manager.js";
export { OpenAIVoiceProvider } from "./openai-voice-provider.js";
export type { OpenAIVoiceProviderConfig } from "./openai-voice-provider.js";

// Audio storage
export type { AudioStore, AudioEntry } from "./audio-store.js";
export { createMemoryAudioStore } from "./audio-store-memory.js";
export { createFileAudioStore } from "./audio-store-file.js";

// Schemas
export { speakRequestSchema, transcribeResponseSchema, speakersResponseSchema, converseResponseHeadersSchema } from "./schemas.js";

// Routes (for advanced use)
export { createVoiceRoutes } from "./routes.js";
export type { VoiceRoutesConfig } from "./routes.js";
