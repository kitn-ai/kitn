import { existsSync } from "fs";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { loadConfig, CLAW_HOME, CONFIG_PATH } from "../config/io.js";

interface StatusInfo {
  configured: boolean;
  provider?: string;
  model?: string;
  configPath: string;
  homePath: string;
  sessions: number;
  workspaceTools: number;
  workspaceAgents: number;
  memoryDbExists: boolean;
}

export async function getStatus(): Promise<StatusInfo> {
  const hasConfig = existsSync(CONFIG_PATH);
  const config = await loadConfig();

  const sessionCount = await countFiles(join(CLAW_HOME, "sessions"), ".jsonl");
  const toolCount = await countFiles(join(CLAW_HOME, "workspace", "tools"), ".ts");
  const agentCount = await countFiles(join(CLAW_HOME, "workspace", "agents"), ".ts");
  const memoryDbExists = existsSync(join(CLAW_HOME, "memory.db"));

  return {
    configured: hasConfig && !!config.provider,
    provider: config.provider?.type,
    model: config.model,
    configPath: CONFIG_PATH,
    homePath: CLAW_HOME,
    sessions: sessionCount,
    workspaceTools: toolCount,
    workspaceAgents: agentCount,
    memoryDbExists,
  };
}

async function countFiles(dir: string, ext: string): Promise<number> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith(ext)).length;
  } catch {
    return 0;
  }
}

export function formatStatus(info: StatusInfo): string {
  const lines: string[] = [];

  if (info.configured) {
    lines.push(`Provider: ${info.provider}`);
    lines.push(`Model:    ${info.model}`);
  } else {
    lines.push("Not configured — run `kitnclaw setup`");
  }

  lines.push("");
  lines.push(`Config:   ${info.configPath}`);
  lines.push(`Home:     ${info.homePath}`);
  lines.push(`Sessions: ${info.sessions}`);
  lines.push(`Memory:   ${info.memoryDbExists ? "initialized" : "not yet created"}`);

  if (info.workspaceTools > 0 || info.workspaceAgents > 0) {
    lines.push("");
    lines.push(`Workspace tools:  ${info.workspaceTools}`);
    lines.push(`Workspace agents: ${info.workspaceAgents}`);
  }

  return lines.join("\n");
}
