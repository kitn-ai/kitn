import { readFile, writeFile, mkdir, chmod } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { parseConfig, type ClawConfig } from "./schema.js";
import { CredentialStore } from "./credentials.js";

export const CLAW_HOME = join(homedir(), ".kitnclaw");
export const CONFIG_PATH = join(CLAW_HOME, "kitnclaw.json");

const DIRS = [
  "",
  "sessions",
  "memory",
  "workspace",
  "workspace/agents",
  "workspace/tools",
  "workspace/skills",
  "credentials",
  "logs",
];

export async function ensureClawHome(): Promise<void> {
  for (const dir of DIRS) {
    await mkdir(join(CLAW_HOME, dir), { recursive: true });
  }
  try {
    await chmod(join(CLAW_HOME, "credentials"), 0o700);
  } catch {
    // Non-critical — may fail on some platforms
  }
}

export async function loadConfig(): Promise<ClawConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return parseConfig(JSON.parse(raw));
  } catch {
    return parseConfig({});
  }
}

export async function saveConfig(config: ClawConfig): Promise<void> {
  await ensureClawHome();
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  try {
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    // Non-critical
  }
}

export function getCredentialStore(): CredentialStore {
  return new CredentialStore({
    path: join(CLAW_HOME, "credentials"),
  });
}
