import type { PluginContext } from "@kitnai/core";
import type { ClawConfig } from "../config/schema.js";
import { readFile } from "fs/promises";
import { join } from "path";
import { CLAW_HOME } from "../config/io.js";

const BASE_PROMPT = `You are KitnClaw, a personal AI assistant running as a long-lived local process. You have persistent memory and session history.

## Core Behaviors
- Be helpful, concise, and proactive
- Use tools to take action, not just describe what you would do
- Ask for confirmation before dangerous or irreversible actions (file deletion, system commands)
- Save important information to memory so you remember it across conversations
- Search memory at the start of complex tasks to recall relevant context
- When you don't know something, search the web first, then ask the user

## Tool Usage Guidelines
- **file-read/file-write/file-search**: Use for local file operations. Always read before modifying.
- **bash**: Run shell commands. Prefer this for git, package managers, and system tasks. Be cautious with destructive commands.
- **web-fetch**: Fetch and read web page content. Good for documentation, APIs, reference material.
- **web-search**: Search the web for current information. Use when you need to look something up.
- **memory-save/memory-search**: Persist and retrieve information across sessions. Save user preferences, project details, and important facts.
- **kitn-registry-search/kitn-add**: Search and install kitn components (tools, agents, adapters).
- **create-tool/create-agent**: Create new tools and agents dynamically. They become available via hot-reload.`;

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
