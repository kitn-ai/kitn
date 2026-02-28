import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(import.meta.dirname, "../.env") });

export const env = createEnv({
  server: {
    OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required — get one at https://openrouter.ai/keys"),
    DEFAULT_MODEL: z.string().default("openai/gpt-4o-mini"),
    API_KEY: z.string().default("demo"),
    PORT: z.coerce.number().default(4000),
    OPENAI_API_KEY: z.string().default(""),
    GROQ_API_KEY: z.string().default(""),
    BRAVE_API_KEY: z.string().default(""),
    VOICE_PROVIDER: z.string().default("openai"),
    VOICE_TTS_MODEL: z.string().default("tts-1"),
    VOICE_STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),
    VOICE_DEFAULT_SPEAKER: z.string().default("alloy"),
    VOICE_RETAIN_AUDIO: z.coerce.boolean().default(false),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: false,
});

function mask(value: string): string {
  if (!value) return "not set";
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

function status(value: string): string {
  return value ? "active" : "not set";
}

export const voiceEnabled = !!(env.OPENAI_API_KEY || env.GROQ_API_KEY);

export function printConfig() {
  console.log("");
  console.log("  Configuration:");
  console.log(`    OPENROUTER_API_KEY : ${mask(env.OPENROUTER_API_KEY)}`);
  console.log(`    DEFAULT_MODEL      : ${env.DEFAULT_MODEL}`);
  console.log(`    API_KEY            : ${mask(env.API_KEY)}`);
  console.log(`    PORT               : ${env.PORT}`);
  console.log("");
  console.log("  Services:");
  console.log(`    AI (OpenRouter)    : active`);
  console.log(`    Voice              : ${voiceEnabled ? `active (${env.VOICE_PROVIDER})` : "no API key"}`);
  console.log(`    Brave Search       : ${status(env.BRAVE_API_KEY)}`);
  console.log(`    Cron Scheduler     : active (internal)`);
  console.log("");

  if (voiceEnabled) {
    console.log("  Voice:");
    console.log(`    Provider           : ${env.VOICE_PROVIDER}`);
    console.log(`    OPENAI_API_KEY     : ${mask(env.OPENAI_API_KEY)}`);
    console.log(`    GROQ_API_KEY       : ${mask(env.GROQ_API_KEY)}`);
    console.log(`    TTS Model          : ${env.VOICE_TTS_MODEL}`);
    console.log(`    STT Model          : ${env.VOICE_STT_MODEL}`);
    console.log(`    Default Speaker    : ${env.VOICE_DEFAULT_SPEAKER}`);
    console.log(`    Retain Audio       : ${env.VOICE_RETAIN_AUDIO}`);
    console.log("");
  }
}
