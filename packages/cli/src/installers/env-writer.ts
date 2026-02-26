import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import type { EnvVarConfig } from "../registry/schema.js";

/**
 * Parse a .env file into a Set of defined variable names.
 * Only cares about keys, not values.
 */
function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      keys.add(trimmed.slice(0, eqIndex).trim());
    }
  }
  return keys;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readEnvFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Collect all envVars from resolved items, deduplicating by key name.
 * Later items override earlier ones if same key.
 */
export function collectEnvVars(
  items: Array<{ envVars?: Record<string, EnvVarConfig> }>
): Record<string, EnvVarConfig> {
  const merged: Record<string, EnvVarConfig> = {};
  for (const item of items) {
    if (item.envVars) {
      Object.assign(merged, item.envVars);
    }
  }
  return merged;
}

/**
 * Handle env var setup after component installation:
 * 1. Write missing vars to .env.example (always)
 * 2. Prompt user for missing vars and write to .env (interactive)
 */
export async function handleEnvVars(
  cwd: string,
  envVars: Record<string, EnvVarConfig>
): Promise<void> {
  const keys = Object.keys(envVars);
  if (keys.length === 0) return;

  // Read existing .env and .env.example
  const envPath = join(cwd, ".env");
  const examplePath = join(cwd, ".env.example");

  const envContent = await readEnvFile(envPath);
  const exampleContent = await readEnvFile(examplePath);

  const envKeys = parseEnvKeys(envContent);
  const exampleKeys = parseEnvKeys(exampleContent);

  // Find vars missing from each file
  const missingFromExample = keys.filter((k) => !exampleKeys.has(k));
  const missingFromEnv = keys.filter((k) => !envKeys.has(k) && !process.env[k]);

  // 1. Always append missing vars to .env.example
  if (missingFromExample.length > 0) {
    const lines: string[] = [];
    if (exampleContent && !exampleContent.endsWith("\n")) lines.push("");
    for (const key of missingFromExample) {
      const config = envVars[key];
      lines.push(`# ${config.description}${config.url ? ` (${config.url})` : ""}`);
      lines.push(`${key}=`);
    }
    await writeFile(examplePath, exampleContent + lines.join("\n") + "\n");
    p.log.info(`Updated ${pc.cyan(".env.example")} with ${missingFromExample.length} variable(s)`);
  }

  // 2. Prompt for missing env vars
  if (missingFromEnv.length === 0) return;

  p.log.message("");
  p.log.warn(
    `${missingFromEnv.length} environment variable(s) needed:`
  );
  for (const key of missingFromEnv) {
    const config = envVars[key];
    const req = config.required !== false ? pc.red("*") : "";
    p.log.message(`  ${pc.yellow(key)}${req}: ${config.description}${config.url ? pc.dim(` -> ${config.url}`) : ""}`);
  }

  const shouldPrompt = await p.confirm({
    message: "Would you like to enter values now?",
    initialValue: true,
  });

  if (p.isCancel(shouldPrompt) || !shouldPrompt) {
    p.log.info(`Add them to ${pc.cyan(".env")} when ready.`);
    return;
  }

  const newEntries: string[] = [];
  for (const key of missingFromEnv) {
    const config = envVars[key];
    const isSecret = config.secret !== false; // default true

    let value: string | symbol;
    if (isSecret) {
      value = await p.password({
        message: `${key}:`,
      });
    } else {
      value = await p.text({
        message: `${key}:`,
        placeholder: config.description,
      });
    }

    if (p.isCancel(value)) {
      p.log.info(`Skipped remaining variables. Add them to ${pc.cyan(".env")} when ready.`);
      break;
    }

    if (value) {
      newEntries.push(`${key}=${value}`);
    }
  }

  if (newEntries.length > 0) {
    const existingEnv = await readEnvFile(envPath);
    const lines: string[] = [];
    if (existingEnv && !existingEnv.endsWith("\n")) lines.push("");
    lines.push(...newEntries);
    await writeFile(envPath, existingEnv + lines.join("\n") + "\n");
    p.log.success(`Wrote ${newEntries.length} variable(s) to ${pc.cyan(".env")}`);
  }
}
