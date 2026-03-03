import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
  banner: { js: "#!/usr/bin/env bun" },
  external: [
    // Provider SDKs are optional — users install only what they need
    "@openrouter/ai-sdk-provider",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@ai-sdk/google",
    // libSQL has native bindings that can't be bundled
    "@libsql/client",
  ],
});
