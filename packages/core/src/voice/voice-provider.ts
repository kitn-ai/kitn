export interface VoiceProvider {
  readonly name: string;
  readonly label: string;
  transcribe(audio: Blob | Buffer, options?: TranscribeOptions): Promise<TranscribeResult>;
  speak(text: string, options?: SpeakOptions): Promise<ReadableStream<Uint8Array>>;
  getSpeakers(): Promise<VoiceSpeaker[]>;
}

export interface TranscribeOptions {
  language?: string;
  prompt?: string;
  model?: string;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface SpeakOptions {
  speaker?: string;
  format?: "mp3" | "opus" | "wav" | "aac" | "flac";
  speed?: number;
  model?: string;
}

export interface VoiceSpeaker {
  voiceId: string;
  name: string;
  [key: string]: unknown;
}
