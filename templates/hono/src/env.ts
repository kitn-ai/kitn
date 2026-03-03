import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    {{api_key_env}}: z
      .string()
      .min(1, "{{api_key_env}} is required — get one at {{api_key_url}}"),
    DEFAULT_MODEL: z.string().default("{{default_model}}"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
