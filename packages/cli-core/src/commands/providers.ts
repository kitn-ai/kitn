// ---------------------------------------------------------------------------
// AI Provider definitions for kitn new / kitn init
// ---------------------------------------------------------------------------

export interface ProviderDef {
  name: string;
  hint: string;
  package: string;
  packageVersion: string;
  importStatement: string;
  providerCall: string;
  envVar: string;
  envPlaceholder: string;
  envUrl: string;
  defaultModel: string;
}

export const PROVIDERS: Record<string, ProviderDef> = {
  openrouter: {
    name: "OpenRouter",
    hint: "access to many models",
    package: "@openrouter/ai-sdk-provider",
    packageVersion: "latest",
    importStatement: 'import { openrouter } from "@openrouter/ai-sdk-provider";',
    providerCall: "openrouter",
    envVar: "OPENROUTER_API_KEY",
    envPlaceholder: "sk-or-v1-your-key-here",
    envUrl: "https://openrouter.ai/keys",
    defaultModel: "openai/gpt-4o-mini",
  },
  openai: {
    name: "OpenAI",
    hint: "GPT-4o, o1, etc.",
    package: "@ai-sdk/openai",
    packageVersion: "latest",
    importStatement: 'import { openai } from "@ai-sdk/openai";',
    providerCall: "openai",
    envVar: "OPENAI_API_KEY",
    envPlaceholder: "sk-your-key-here",
    envUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-4o-mini",
  },
  anthropic: {
    name: "Anthropic",
    hint: "Claude models",
    package: "@ai-sdk/anthropic",
    packageVersion: "latest",
    importStatement: 'import { anthropic } from "@ai-sdk/anthropic";',
    providerCall: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    envPlaceholder: "sk-ant-your-key-here",
    envUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-sonnet-4-20250514",
  },
  google: {
    name: "Google Gemini",
    hint: "Gemini models",
    package: "@ai-sdk/google",
    packageVersion: "latest",
    importStatement: 'import { google } from "@ai-sdk/google";',
    providerCall: "google",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    envPlaceholder: "your-key-here",
    envUrl: "https://aistudio.google.com/apikey",
    defaultModel: "gemini-2.0-flash",
  },
};

export const VALID_PROVIDERS = Object.keys(PROVIDERS);
