import { z } from "zod";
import "@asteasolutions/zod-to-openapi";

export const speakRequestSchema = z.object({
  text: z.string().min(1).openapi({ example: "Hello, how can I help you today?" }),
  speaker: z.string().optional().openapi({ example: "alloy" }),
  format: z.enum(["mp3", "opus", "wav", "aac", "flac"]).optional().openapi({ example: "mp3" }),
  speed: z.number().min(0.25).max(4.0).optional().openapi({ example: 1.0 }),
  model: z.string().optional(),
  save: z.boolean().optional().openapi({ description: "When true, buffer and save the audio server-side, returning X-Audio-Id header" }),
});

export const transcribeResponseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
});

export const speakersResponseSchema = z.object({
  speakers: z.array(z.object({ voiceId: z.string(), name: z.string() })),
  provider: z.string(),
});

export const converseResponseHeadersSchema = z.object({
  "X-Transcription": z.string(),
  "X-Response-Text": z.string(),
  "X-Conversation-Id": z.string().optional(),
});
