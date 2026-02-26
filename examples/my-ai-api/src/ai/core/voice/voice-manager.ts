import type { VoiceProvider } from "./voice-provider.js";

export class VoiceManager {
  private providers = new Map<string, VoiceProvider>();
  private defaultProvider: string | null = null;

  register(provider: VoiceProvider) {
    this.providers.set(provider.name, provider);
    if (!this.defaultProvider) {
      this.defaultProvider = provider.name;
    }
  }

  get(name?: string): VoiceProvider | undefined {
    return this.providers.get(name ?? this.defaultProvider ?? "");
  }

  list(): VoiceProvider[] {
    return [...this.providers.values()];
  }

  listNames(): string[] {
    return [...this.providers.keys()];
  }

  getDefault(): string | null {
    return this.defaultProvider;
  }

  isAvailable(): boolean {
    return this.providers.size > 0;
  }
}
