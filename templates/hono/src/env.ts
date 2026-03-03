import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    OPENROUTER_API_KEY: z
      .string()
      .min(1, "OPENROUTER_API_KEY is required — get one at https://openrouter.ai/keys"),
    DEFAULT_MODEL: z.string().default("openai/gpt-4o-mini"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
