import type { KitnPlugin } from "@kitnai/core";
import { VoiceManager } from "./voice-manager.js";
import type { VoiceProvider } from "./voice-provider.js";
import type { AudioStore } from "./audio-store.js";
import { createMemoryAudioStore } from "./audio-store-memory.js";
import { createVoiceRoutes } from "./routes.js";

export interface VoicePluginConfig {
  /** Voice providers to register (first becomes default) */
  providers: VoiceProvider[];
  /** Save uploaded audio server-side by default */
  retainAudio?: boolean;
  /** Custom AudioStore implementation. Defaults to in-memory. */
  audioStore?: AudioStore;
}

export function createVoice(config: VoicePluginConfig): KitnPlugin {
  const voiceManager = new VoiceManager();
  for (const provider of config.providers) {
    voiceManager.register(provider);
  }
  const audioStore = config.audioStore ?? createMemoryAudioStore();
  const routes = createVoiceRoutes({
    voiceManager,
    audioStore,
    retainAudio: config.retainAudio,
  });
  return { name: "voice", prefix: "/voice", routes };
}
