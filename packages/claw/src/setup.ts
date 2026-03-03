import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { loadConfig, saveConfig, ensureClawHome, CLAW_HOME, CONFIG_PATH } from "./config/io.js";
import type { ClawConfig } from "./config/schema.js";

const PROVIDER_OPTIONS = [
  { value: "openrouter", label: "OpenRouter", hint: "access multiple providers via one API key" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google (Gemini)" },
  { value: "ollama", label: "Ollama", hint: "local models, no API key needed" },
  { value: "custom", label: "Custom (OpenAI-compatible)", hint: "any OpenAI-compatible endpoint" },
] as const;

const DEFAULT_MODELS: Record<string, string> = {
  openrouter: "openai/gpt-4o-mini",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
  ollama: "llama3.2",
  custom: "gpt-4o-mini",
};

const NEEDS_API_KEY = new Set(["openrouter", "openai", "anthropic", "google", "custom"]);
const NEEDS_BASE_URL = new Set(["custom"]);

export async function setupWizard(): Promise<void> {
  p.intro(pc.cyan("KitnClaw Setup"));

  await ensureClawHome();

  const existing = await loadConfig();
  const isUpdate = existsSync(CONFIG_PATH);

  if (isUpdate) {
    p.log.info(
      `Existing config found at ${pc.dim(CONFIG_PATH)}\n` +
      `  Provider: ${pc.bold(existing.provider?.type ?? "none")}\n` +
      `  Model: ${pc.bold(existing.model)}`,
    );
  }

  // 1. Provider type
  const providerType = await p.select({
    message: "Which AI provider do you want to use?",
    options: PROVIDER_OPTIONS.map((opt) => ({
      ...opt,
      label: existing.provider?.type === opt.value
        ? `${opt.label} ${pc.dim("(current)")}`
        : opt.label,
    })),
    initialValue: existing.provider?.type ?? "openrouter",
  });

  if (p.isCancel(providerType)) {
    p.cancel("Setup cancelled.");
    return;
  }

  // 2. API key
  let apiKey: string | undefined;
  if (NEEDS_API_KEY.has(providerType)) {
    const currentKey = existing.provider?.type === providerType
      ? existing.provider.apiKey
      : undefined;

    const maskedCurrent = currentKey
      ? `${currentKey.slice(0, 4)}...${currentKey.slice(-4)}`
      : undefined;

    const keyInput = await p.text({
      message: `Enter your ${providerType} API key:`,
      placeholder: maskedCurrent
        ? `Press Enter to keep current (${maskedCurrent})`
        : "sk-...",
      validate: (val) => {
        if (!val && !currentKey) return "API key is required";
      },
    });

    if (p.isCancel(keyInput)) {
      p.cancel("Setup cancelled.");
      return;
    }

    apiKey = keyInput || currentKey;
  }

  // 3. Base URL (for custom/ollama)
  let baseUrl: string | undefined;
  if (NEEDS_BASE_URL.has(providerType)) {
    const currentUrl = existing.provider?.baseUrl;
    const urlInput = await p.text({
      message: "Base URL for the OpenAI-compatible endpoint:",
      placeholder: currentUrl ?? "https://api.example.com/v1",
      validate: (val) => {
        if (!val && !currentUrl) return "Base URL is required for custom providers";
      },
    });

    if (p.isCancel(urlInput)) {
      p.cancel("Setup cancelled.");
      return;
    }

    baseUrl = urlInput || currentUrl;
  } else if (providerType === "ollama") {
    const ollamaUrl = await p.text({
      message: "Ollama base URL:",
      placeholder: "http://localhost:11434/v1",
      defaultValue: "http://localhost:11434/v1",
    });

    if (p.isCancel(ollamaUrl)) {
      p.cancel("Setup cancelled.");
      return;
    }

    baseUrl = ollamaUrl || "http://localhost:11434/v1";
  }

  // 4. Model
  const defaultModel = DEFAULT_MODELS[providerType] ?? "gpt-4o-mini";
  const currentModel = existing.model !== "openai/gpt-4o-mini" ? existing.model : undefined;

  const modelInput = await p.text({
    message: "Default model ID:",
    placeholder: defaultModel,
    defaultValue: currentModel ?? defaultModel,
  });

  if (p.isCancel(modelInput)) {
    p.cancel("Setup cancelled.");
    return;
  }

  const model = modelInput || defaultModel;

  // Build the updated config
  const config: ClawConfig = {
    ...existing,
    provider: {
      type: providerType as ClawConfig["provider"] extends undefined ? never : NonNullable<ClawConfig["provider"]>["type"],
      ...(apiKey && { apiKey }),
      ...(baseUrl && { baseUrl }),
    },
    model,
  };

  await saveConfig(config);

  p.log.success(`Config saved to ${pc.dim(CONFIG_PATH)}`);
  p.log.info(
    `  Provider: ${pc.bold(providerType)}\n` +
    `  Model: ${pc.bold(model)}` +
    (apiKey ? `\n  API key: ${pc.dim(`${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`)}` : "") +
    (baseUrl ? `\n  Base URL: ${pc.dim(baseUrl)}` : ""),
  );

  // Install provider SDK hint
  const sdkMap: Record<string, string> = {
    openrouter: "@openrouter/ai-sdk-provider",
    openai: "@ai-sdk/openai",
    anthropic: "@ai-sdk/anthropic",
    google: "@ai-sdk/google",
    ollama: "@ai-sdk/openai",
    custom: "@ai-sdk/openai",
  };
  const sdk = sdkMap[providerType];
  if (sdk) {
    p.log.info(`Make sure to install the provider SDK: ${pc.cyan(`bun add ${sdk}`)}`);
  }

  // Create default SOUL.md if it doesn't exist
  const soulPath = join(CLAW_HOME, "workspace", "SOUL.md");
  if (!existsSync(soulPath)) {
    await writeFile(soulPath, DEFAULT_SOUL, "utf-8");
    p.log.info(`Created ${pc.dim(soulPath)} — edit to customize your assistant's personality`);
  }

  p.outro(pc.green("Setup complete! Run") + " " + pc.cyan("kitnclaw start") + " " + pc.green("to launch."));
}

const DEFAULT_SOUL = `# KitnClaw Personality

Edit this file to customize how your assistant behaves.

## Style
- Respond concisely and directly
- Use markdown formatting when helpful
- Be proactive — suggest next steps when appropriate

## Knowledge
- You are a local AI assistant with access to the filesystem, web, and memory
- You can create new tools and agents to extend your own capabilities
- You persist across sessions — remember what the user has told you
`;
