import type { LanguageModel } from "ai";
import type { ClawConfig } from "../config/schema.js";

/**
 * Create a model factory function from the config.
 *
 * Returns a `(id?: string) => Promise<LanguageModel>` that creates AI SDK models
 * using the configured provider. Provider SDKs are dynamically imported
 * so they're optional dependencies — users install only what they need.
 */
export function createModelFactory(
  config: ClawConfig,
): (id?: string) => LanguageModel {
  return (id?: string) => {
    const modelId = id ?? config.model;
    const provider = config.provider;

    if (!provider) {
      throw new Error(
        "No AI provider configured. Run `kitnclaw setup` or edit ~/.kitnclaw/kitnclaw.json",
      );
    }

    // Provider SDKs are loaded lazily via a synchronous cache.
    // The factory itself is sync (returns LanguageModel, not Promise),
    // so we rely on Bun's synchronous require for dynamic loading.
    // These packages are marked external in tsup.config.ts.
    try {
      switch (provider.type) {
        case "openrouter": {
          const mod = require("@openrouter/ai-sdk-provider");
          return mod.createOpenRouter({ apiKey: provider.apiKey })(modelId);
        }
        case "openai": {
          const mod = require("@ai-sdk/openai");
          return mod.createOpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.baseUrl,
          })(modelId);
        }
        case "anthropic": {
          const mod = require("@ai-sdk/anthropic");
          return mod.createAnthropic({ apiKey: provider.apiKey })(modelId);
        }
        case "google": {
          const mod = require("@ai-sdk/google");
          return mod.createGoogleGenerativeAI({ apiKey: provider.apiKey })(modelId);
        }
        case "ollama": {
          const mod = require("@ai-sdk/openai");
          return mod.createOpenAI({
            baseURL: provider.baseUrl ?? "http://localhost:11434/v1",
            apiKey: "ollama",
          })(modelId);
        }
        case "custom": {
          const mod = require("@ai-sdk/openai");
          return mod.createOpenAI({
            baseURL: provider.baseUrl,
            apiKey: provider.apiKey,
          })(modelId);
        }
        default:
          throw new Error(`Unknown provider type: ${(provider as any).type}`);
      }
    } catch (err: any) {
      if (err.code === "MODULE_NOT_FOUND" || err.code === "ERR_MODULE_NOT_FOUND") {
        const pkgMap: Record<string, string> = {
          openrouter: "@openrouter/ai-sdk-provider",
          openai: "@ai-sdk/openai",
          anthropic: "@ai-sdk/anthropic",
          google: "@ai-sdk/google",
          ollama: "@ai-sdk/openai",
          custom: "@ai-sdk/openai",
        };
        const pkg = pkgMap[provider.type] ?? "the provider SDK";
        throw new Error(
          `Provider "${provider.type}" requires ${pkg}. Install it with: bun add ${pkg}`,
        );
      }
      throw err;
    }
  };
}
