import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { readConfig } from "../config/io.js";
import { getRegistryUrl, DEFAULT_REGISTRIES, DEFAULT_ALIASES } from "../types/config.js";
import type { KitnConfig } from "../types/config.js";
import { renderTemplate, wrapContent } from "../rules/template.js";
import type { RulesConfig } from "../rules/template.js";

// ---------------------------------------------------------------------------
// Fallback content
// ---------------------------------------------------------------------------

export const FALLBACK_CONFIG: RulesConfig = {
  version: "1.0.0",
  tools: [
    {
      id: "claude-code",
      name: "Claude Code",
      filePath: "AGENTS.md",
      format: "plain",
      description: "Also works with any tool that reads AGENTS.md",
    },
    {
      id: "cursor",
      name: "Cursor",
      filePath: ".cursor/rules/kitn.mdc",
      format: "mdc",
      frontmatter: {
        description: "kitn AI agent framework conventions and patterns",
        globs: "src/ai/**/*.ts, src/ai/**/*.md, kitn.json, kitn.lock",
      },
    },
    {
      id: "github-copilot",
      name: "GitHub Copilot",
      filePath: ".github/copilot-instructions.md",
      format: "plain",
    },
    {
      id: "cline",
      name: "Cline",
      filePath: ".clinerules",
      format: "plain",
    },
    {
      id: "windsurf",
      name: "Windsurf",
      filePath: ".windsurfrules",
      format: "plain",
    },
  ],
};

// ---------------------------------------------------------------------------
// Registry URL derivation
// ---------------------------------------------------------------------------

/**
 * Derive the rules base URL from the registry URL template.
 * e.g. "https://kitn-ai.github.io/kitn/r/{type}/{name}.json"
 *    -> "https://kitn-ai.github.io/kitn/r/rules/"
 */
export function deriveRulesBaseUrl(registries: KitnConfig["registries"]): string {
  const kitnEntry = registries["@kitn"];
  if (!kitnEntry) {
    throw new Error("No @kitn registry configured");
  }
  const url = getRegistryUrl(kitnEntry);
  return url.replace("{type}/{name}.json", "rules/");
}

// ---------------------------------------------------------------------------
// Registry fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the rules config from the registry.
 * Falls back to FALLBACK_CONFIG on any error.
 */
export async function fetchRulesConfig(
  registries: KitnConfig["registries"],
): Promise<RulesConfig> {
  try {
    const baseUrl = deriveRulesBaseUrl(registries);
    const res = await fetch(baseUrl + "config.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as RulesConfig;
  } catch {
    return FALLBACK_CONFIG;
  }
}

/**
 * Fetch the rules template from the registry.
 * Falls back to the provided fallbackTemplate on any error.
 * If no fallbackTemplate is provided, returns a minimal default.
 */
export async function fetchRulesTemplate(
  registries: KitnConfig["registries"],
  fallbackTemplate?: string,
): Promise<string> {
  try {
    const baseUrl = deriveRulesBaseUrl(registries);
    const res = await fetch(baseUrl + "template.md");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch {
    return fallbackTemplate ?? "# kitn AI Agent Framework\n\nThis project uses kitn.\n";
  }
}

// ---------------------------------------------------------------------------
// File generation
// ---------------------------------------------------------------------------

/**
 * Fetch config + template from registry, render with project aliases,
 * and write rules files for each selected tool.
 *
 * @returns List of file paths written (relative to cwd).
 */
export async function generateRulesFiles(
  cwd: string,
  config: KitnConfig,
  selectedToolIds?: string[],
  fallbackTemplate?: string,
): Promise<string[]> {
  const rulesConfig = await fetchRulesConfig(config.registries);
  const template = await fetchRulesTemplate(config.registries, fallbackTemplate);
  const rendered = renderTemplate(template, config.aliases);

  const toolsToWrite = selectedToolIds
    ? rulesConfig.tools.filter((t) => selectedToolIds.includes(t.id))
    : rulesConfig.tools;

  const written: string[] = [];

  for (const tool of toolsToWrite) {
    const content = wrapContent(rendered, tool);
    const filePath = join(cwd, tool.filePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    written.push(tool.filePath);
  }

  return written;
}

// ---------------------------------------------------------------------------
// Main command: regenerateRules
// ---------------------------------------------------------------------------

/**
 * Generate rules files for the project.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * If no toolIds are specified, all tools from the rules config are used.
 * If no kitn.json exists, uses default registries and aliases.
 *
 * @returns Object with the rules config (for tool selection) and a generate function.
 */
export async function regenerateRules(opts: {
  cwd: string;
  toolIds?: string[];
  fallbackTemplate?: string;
}): Promise<string[]> {
  const { cwd, toolIds, fallbackTemplate } = opts;

  const config = await readConfig(cwd);

  // Use project config if available, otherwise defaults
  const registries = config?.registries ?? DEFAULT_REGISTRIES;
  const aliases = config?.aliases ?? DEFAULT_ALIASES;

  const effectiveConfig = { registries, aliases } as KitnConfig;

  return generateRulesFiles(cwd, effectiveConfig, toolIds, fallbackTemplate);
}

/**
 * Fetch the rules config for tool selection UI.
 * Uses project config if available, otherwise defaults.
 */
export async function getRulesConfig(cwd: string): Promise<RulesConfig> {
  const config = await readConfig(cwd);
  const registries = config?.registries ?? DEFAULT_REGISTRIES;
  return fetchRulesConfig(registries);
}
