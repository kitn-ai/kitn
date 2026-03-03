import { readFile, writeFile } from "fs/promises";
import { readConfig } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { resolveToolByName, resolveAgentByName } from "../utils/component-resolver.js";
import { linkToolToAgent } from "../installers/agent-linker.js";
import type { ToolRef } from "../installers/agent-linker.js";

export interface LinkToolOpts {
  toolName: string;
  agentName: string;
  cwd: string;
  alias?: string;
}

export interface LinkToolResult {
  success: boolean;
  changed: boolean;
  agentFile: string;
  toolExportName: string;
  toolImportPath: string;
  error?: string;
}

/**
 * Link a tool to an agent in a kitn project.
 *
 * Pure logic — no interactive prompts. All inputs must be provided upfront.
 * Returns a structured result describing what happened.
 */
export async function linkToolInProject(opts: LinkToolOpts): Promise<LinkToolResult> {
  const { toolName, agentName, cwd, alias } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const tool = await resolveToolByName(toolName, config, cwd);
  if (!tool) {
    throw new Error(
      `Tool "${toolName}" not found. Check that the file exists in your tools directory.`,
    );
  }

  const agent = await resolveAgentByName(agentName, config, cwd);
  if (!agent) {
    throw new Error(
      `Agent "${agentName}" not found. Check that the file exists in your agents directory.`,
    );
  }

  const agentContent = await readFile(agent.filePath, "utf-8");
  const toolRef: ToolRef = {
    exportName: tool.exportName,
    importPath: tool.importPath,
  };

  const result = linkToolToAgent(agentContent, toolRef, alias);

  if (result.error) {
    return {
      success: false,
      changed: false,
      agentFile: agent.filePath,
      toolExportName: tool.exportName,
      toolImportPath: tool.importPath,
      error: result.error,
    };
  }

  if (!result.changed) {
    return {
      success: true,
      changed: false,
      agentFile: agent.filePath,
      toolExportName: tool.exportName,
      toolImportPath: tool.importPath,
    };
  }

  await writeFile(agent.filePath, result.content);

  return {
    success: true,
    changed: true,
    agentFile: agent.filePath,
    toolExportName: tool.exportName,
    toolImportPath: tool.importPath,
  };
}
