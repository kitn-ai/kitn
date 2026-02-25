import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_API_URL: z.string().url().default("http://localhost:3000"),
    VITE_API_KEY: z.string().min(1).default("demo"),
  },
  runtimeEnv: import.meta.env,
});
