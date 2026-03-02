import { readFile } from "fs/promises";
import { join } from "path";
import type { KitnConfig } from "../utils/config.js";
import {
  fetchRulesConfig as coreFetchRulesConfig,
  fetchRulesTemplate as coreFetchRulesTemplate,
  generateRulesFiles as coreGenerateRulesFiles,
  regenerateRules as coreRegenerateRules,
  getRulesConfig,
  FALLBACK_CONFIG,
  deriveRulesBaseUrl,
} from "@kitnai/cli-core";

// Re-export types and pure functions that don't need wrapping
export {
  renderTemplate,
  wrapContent,
  type RulesConfig,
  type RulesTool,
  FALLBACK_CONFIG,
  deriveRulesBaseUrl,
  getRulesConfig,
} from "@kitnai/cli-core";

// ---------------------------------------------------------------------------
// Local fallback template
// ---------------------------------------------------------------------------

const TEMPLATE_PATH = join(import.meta.dirname, "rules-template.md");

let _fallbackTemplate: string | undefined;

export async function loadFallbackTemplate(): Promise<string> {
  if (!_fallbackTemplate) {
    _fallbackTemplate = await readFile(TEMPLATE_PATH, "utf-8");
  }
  return _fallbackTemplate;
}

// ---------------------------------------------------------------------------
// Wrapped functions that inject the local fallback template
// ---------------------------------------------------------------------------

/**
 * Fetch the rules config from the registry.
 * Falls back to FALLBACK_CONFIG on any error.
 */
export async function fetchRulesConfig(
  registries: KitnConfig["registries"],
) {
  return coreFetchRulesConfig(registries);
}

/**
 * Fetch the rules template from the registry.
 * Falls back to the bundled rules-template.md on any error.
 */
export async function fetchRulesTemplate(
  registries: KitnConfig["registries"],
) {
  const fallback = await loadFallbackTemplate();
  return coreFetchRulesTemplate(registries, fallback);
}

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
) {
  const fallback = await loadFallbackTemplate();
  return coreGenerateRulesFiles(cwd, config, selectedToolIds, fallback);
}

/**
 * Generate rules files for the project.
 * Wraps cli-core's regenerateRules with the bundled fallback template.
 */
export async function regenerateRules(opts: {
  cwd: string;
  toolIds?: string[];
}) {
  const fallback = await loadFallbackTemplate();
  return coreRegenerateRules({
    ...opts,
    fallbackTemplate: fallback,
  });
}
