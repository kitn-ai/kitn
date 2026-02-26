import type {
  VoiceProvider,
  TranscribeOptions,
  TranscribeResult,
  SpeakOptions,
  VoiceSpeaker,
} from "./voice-provider.js";

const OPENAI_BASE = "https://api.openai.com/v1";

const VOICES: VoiceSpeaker[] = [
  { voiceId: "alloy", name: "Alloy", description: "Neutral and balanced" },
  { voiceId: "echo", name: "Echo", description: "Warm and clear" },
  { voiceId: "fable", name: "Fable", description: "Expressive and animated" },
  { voiceId: "onyx", name: "Onyx", description: "Deep and authoritative" },
  { voiceId: "nova", name: "Nova", description: "Friendly and upbeat" },
  { voiceId: "shimmer", name: "Shimmer", description: "Gentle and calm" },
];

export interface OpenAIVoiceProviderConfig {
  apiKey: string;
  baseUrl?: string;
  name?: string;
  label?: string;
  ttsModel?: string;
  sttModel?: string;
  defaultSpeaker?: string;
}

export class OpenAIVoiceProvider implements VoiceProvider {
  readonly name: string;
  readonly label: string;

  private apiKey: string;
  private baseUrl: string;
  private ttsModel: string;
  private sttModel: string;
  private defaultSpeaker: string;

  constructor(config: OpenAIVoiceProviderConfig) {
    this.name = config.name ?? "openai";
    this.label = config.label ?? "OpenAI";
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? OPENAI_BASE).replace(/\/$/, "");
    this.ttsModel = config.ttsModel ?? "tts-1";
    this.sttModel = config.sttModel ?? "gpt-4o-mini-transcribe";
    this.defaultSpeaker = config.defaultSpeaker ?? "alloy";
  }

  async transcribe(audio: Blob | Buffer, options?: TranscribeOptions): Promise<TranscribeResult> {
    const form = new FormData();

    // Always re-buffer to a fresh Blob to avoid Bun runtime issues
    // where File objects from parsed formData can't be re-sent reliably
    let blob: Blob;
    if (audio instanceof Blob) {
      const buffer = await audio.arrayBuffer();
      blob = new Blob([buffer], { type: (audio as File).type || "audio/webm" });
    } else {
      blob = new Blob([new Uint8Array(audio)], { type: "audio/webm" });
    }
    form.append("file", blob, "audio.webm");
    form.append("model", options?.model ?? this.sttModel);
    if (options?.language) form.append("language", options.language);
    if (options?.prompt) form.append("prompt", options.prompt);
    form.append("response_format", "verbose_json");

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`OpenAI STT failed (${res.status}): ${error}`);
    }

    const data = await res.json() as any;
    return { text: data.text, language: data.language, duration: data.duration };
  }

  async speak(text: string, options?: SpeakOptions): Promise<ReadableStream<Uint8Array>> {
    const format = options?.format ?? "mp3";
    const speaker = options?.speaker ?? this.defaultSpeaker;
    const speed = options?.speed ?? 1.0;

    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options?.model ?? this.ttsModel,
        input: text,
        voice: speaker,
        response_format: format,
        speed,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`OpenAI TTS failed (${res.status}): ${error}`);
    }

    if (!res.body) throw new Error("OpenAI TTS returned no body");
    return res.body as ReadableStream<Uint8Array>;
  }

  async getSpeakers(): Promise<VoiceSpeaker[]> {
    return VOICES;
  }
}
