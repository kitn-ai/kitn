import { z } from "@hono/zod-openapi";

export const HealthCheckResponseSchema = z.object({
  status: z.string().openapi({ example: "ok" }),
  timestamp: z.string().openapi({ example: "2025-01-07T12:00:00.000Z" }),
});

export const ErrorResponseSchema = z.object({
  error: z.string().openapi({ example: "An error occurred" }),
  details: z
    .string()
    .optional()
    .openapi({ example: "Detailed error information" }),
});
