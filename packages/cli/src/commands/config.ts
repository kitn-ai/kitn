import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

const CONFIG_DIR = join(homedir(), ".kitn");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// Valid config keys - this is a whitelist
const VALID_KEYS = ["chat-url", "api-key"] as const;
type ConfigKey = (typeof VALID_KEYS)[number];

export async function readUserConfig(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeUserConfig(config: Record<string, string>): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export async function configSetCommand(key: string, value: string): Promise<void> {
  if (!VALID_KEYS.includes(key as ConfigKey)) {
    p.log.error(`Unknown config key: ${pc.red(key)}`);
    p.log.info(`Valid keys: ${VALID_KEYS.join(", ")}`);
    process.exit(1);
  }

  const config = await readUserConfig();
  config[key] = value;
  await writeUserConfig(config);

  // Mask api-key values in output
  const displayValue = key.includes("key") ? value.slice(0, 8) + "..." : value;
  p.log.success(`Set ${pc.cyan(key)} = ${pc.green(displayValue)}`);
}

export async function configGetCommand(key: string): Promise<void> {
  const config = await readUserConfig();
  const value = config[key];
  if (value === undefined) {
    p.log.warn(`${pc.cyan(key)} is not set`);
  } else {
    const displayValue = key.includes("key") ? value.slice(0, 8) + "..." : value;
    p.log.info(`${pc.cyan(key)} = ${pc.green(displayValue)}`);
  }
}

export async function configListCommand(): Promise<void> {
  const config = await readUserConfig();
  const entries = Object.entries(config);
  if (entries.length === 0) {
    p.log.info("No user configuration set.");
    p.log.info(`Run ${pc.cyan("kitn config set <key> <value>")} to configure.`);
    return;
  }
  for (const [key, value] of entries) {
    const displayValue = key.includes("key") ? value.slice(0, 8) + "..." : value;
    p.log.info(`${pc.cyan(key)} = ${pc.green(displayValue)}`);
  }
}
