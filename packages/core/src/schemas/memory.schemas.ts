import { z } from "zod";

export const memoryEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
  context: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const memorySaveSchema = z.object({
  key: z.string().min(1).openapi({ example: "user_name" }),
  value: z.string().min(1).openapi({ example: "John" }),
  context: z.string().optional().default("").openapi({
    example: "user preferences",
    description: "What this memory is for",
  }),
});
