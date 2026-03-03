import type { PluginContext } from "@kitnai/core";
import type { ClawConfig } from "../config/schema.js";
import { readFile } from "fs/promises";
import { join } from "path";
import { CLAW_HOME } from "../config/io.js";

const BASE_PROMPT = `You are KitnClaw, a personal AI assistant. You help users accomplish tasks by using tools when needed.

Key behaviors:
- Be helpful, concise, and proactive
- Use tools to take action, not just describe what you would do
- Ask for confirmation before performing dangerous or irreversible actions
- Remember information across conversations using the memory tools
- When you don't know something, search the web or ask the user`;

/**
 * Assemble the full system prompt from layered sources.
 */
export async function buildSystemPrompt(
  ctx: PluginContext,
  config: ClawConfig,
  channelType: string,
): Promise<string> {
  const parts: string[] = [BASE_PROMPT];

  // Load SOUL.md personality if it exists
  const soulPath = join(CLAW_HOME, "workspace", "SOUL.md");
  try {
    const soul = await readFile(soulPath, "utf-8");
    if (soul.trim()) {
      parts.push(`\n## Personality\n${soul.trim()}`);
    }
  } catch {
    // No SOUL.md — use default personality
  }

  // Add available tool descriptions
  const tools = ctx.tools.list();
  if (tools.length > 0) {
    const toolList = tools
      .map((t) => `- **${t.name}**: ${t.description}`)
      .join("\n");
    parts.push(`\n## Available Tools\n${toolList}`);
  }

  // Add channel context
  parts.push(`\n## Context\n- Channel: ${channelType}\n- Model: ${config.model}`);

  return parts.join("\n");
}
