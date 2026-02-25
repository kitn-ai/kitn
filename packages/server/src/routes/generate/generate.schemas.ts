import { z } from "zod";

export const generateRequestSchema = z.object({
  prompt: z.string().min(1).openapi({ example: "Explain what an AI agent is" }),
  systemPrompt: z.string().optional().openapi({ example: "You are a helpful assistant" }),
  model: z.string().optional().openapi({ example: "openai/gpt-4o-mini" }),
  tools: z.array(z.string()).optional().openapi({ example: ["myTool"] }),
  maxSteps: z.number().min(1).max(10).default(5),
});

export const generateResponseSchema = z.object({
  text: z.string(),
  model: z.string(),
  usage: z.object({
    inputTokens: z.number().openapi({ example: 25 }),
    outputTokens: z.number().openapi({ example: 150 }),
    totalTokens: z.number().openapi({ example: 175 }),
  }),
  toolResults: z.array(z.any()).optional(),
  finishReason: z.string(),
});
