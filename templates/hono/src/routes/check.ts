import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { generateText } from "ai";
{{provider_import}}
import type { Env } from "../env.js";

const CheckResponseSchema = z.object({
  ok: z.boolean().openapi({ example: true }),
  model: z.string().openapi({ example: "openai/gpt-4o-mini" }),
  response: z
    .string()
    .optional()
    .openapi({ example: "Hello! I'm working correctly." }),
  error: z
    .string()
    .optional()
    .openapi({ example: "Authentication failed" }),
});

const route = createRoute({
  method: "post",
  path: "/check",
  tags: ["Health"],
  summary: "Test AI connection",
  description:
    "Sends a simple prompt to the configured AI model and returns the response. Use this to verify your API key and model are working.",
  responses: {
    200: {
      description: "AI connection check result",
      content: {
        "application/json": { schema: CheckResponseSchema },
      },
    },
  },
});

export function registerCheckRoute(app: OpenAPIHono, env: Env) {
  app.openapi(route, async (c) => {
    const model = env.DEFAULT_MODEL;
    try {
      const { text } = await generateText({
        model: {{provider_call}}(model),
        prompt: "Say hello in one short sentence.",
        maxOutputTokens: 50,
      });

      return c.json({ ok: true, model, response: text });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ ok: false, model, error: message });
    }
  });
}
