import { writeFile, mkdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import type { KitnConfig } from "../utils/config.js";
import { getRegistryUrl } from "../utils/config.js";

const TEMPLATE_PATH = join(import.meta.dirname, "rules-template.md");

// ---------- Types ----------

export interface RulesConfig {
  version: string;
  tools: RulesTool[];
}

export interface RulesTool {
  id: string;
  name: string;
  filePath: string;
  format: "plain" | "mdc";
  description?: string;
  frontmatter?: Record<string, string>;
}

// ---------- Fallback content ----------

const FALLBACK_CONFIG: RulesConfig = {
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

let _fallbackTemplate: string | undefined;

async function loadFallbackTemplate(): Promise<string> {
  if (!_fallbackTemplate) {
    _fallbackTemplate = await readFile(TEMPLATE_PATH, "utf-8");
  }
  return _fallbackTemplate;
}

// ---------- Registry fetch helpers ----------

/**
 * Derive the rules base URL from the registry URL template.
 * e.g. "https://kitn-ai.github.io/kitn/r/{type}/{name}.json"
 *    -> "https://kitn-ai.github.io/kitn/r/rules/"
 */
function deriveRulesBaseUrl(registries: KitnConfig["registries"]): string {
  const kitnEntry = registries["@kitn"];
  if (!kitnEntry) {
    throw new Error("No @kitn registry configured");
  }
  const url = getRegistryUrl(kitnEntry);
  return url.replace("{type}/{name}.json", "rules/");
}

/** Fetch the rules config from the registry. */
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

/** Fetch the rules template from the registry. */
export async function fetchRulesTemplate(
  registries: KitnConfig["registries"],
): Promise<string> {
  try {
    const baseUrl = deriveRulesBaseUrl(registries);
    const res = await fetch(baseUrl + "template.md");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch {
    return loadFallbackTemplate();
  }
}

// ---------- Template rendering ----------

interface Aliases {
  base?: string;
  agents: string;
  tools: string;
  skills: string;
  storage: string;
  crons?: string;
}

/** Substitute {base}, {agents}, {tools}, {skills}, {storage}, {crons} with actual aliases. */
export function renderTemplate(template: string, aliases: Aliases): string {
  const base = aliases.base ?? "src/ai";
  return template
    .replace(/\{base\}/g, base)
    .replace(/\{agents\}/g, aliases.agents)
    .replace(/\{tools\}/g, aliases.tools)
    .replace(/\{skills\}/g, aliases.skills)
    .replace(/\{storage\}/g, aliases.storage)
    .replace(/\{crons\}/g, aliases.crons ?? `${base}/crons`);
}

/** Wrap content for a specific format (plain passthrough, mdc adds frontmatter). */
export function wrapContent(content: string, tool: RulesTool): string {
  if (tool.format === "mdc" && tool.frontmatter) {
    const lines = Object.entries(tool.frontmatter).map(
      ([key, value]) => `${key}: ${value}`,
    );
    return `---\n${lines.join("\n")}\n---\n\n${content}`;
  }
  return content;
}

// ---------- Main entry ----------

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
): Promise<string[]> {
  const rulesConfig = await fetchRulesConfig(config.registries);
  const template = await fetchRulesTemplate(config.registries);
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
