import { z } from "@hono/zod-openapi";

export const HealthResponseSchema = z.object({
  status: z.string().openapi({ example: "ok" }),
  timestamp: z.string().openapi({ example: "2026-02-25T12:00:00.000Z" }),
  uptime: z.number().openapi({ example: 123.456, description: "Process uptime in seconds" }),
});

export const PingResponseSchema = z.object({
  pong: z.literal(true).openapi({ example: true }),
});

export const ErrorResponseSchema = z.object({
  error: z.string().openapi({ example: "An error occurred" }),
  details: z.string().optional().openapi({ example: "Detailed error information" }),
});
