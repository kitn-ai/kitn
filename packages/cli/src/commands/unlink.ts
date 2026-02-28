import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile, writeFile } from "fs/promises";
import { basename } from "path";
import { readConfig } from "../utils/config.js";
import {
  resolveToolByName,
  resolveAgentByName,
  listTools,
  listAgents,
} from "../utils/component-resolver.js";
import { unlinkToolFromAgent } from "../installers/agent-linker.js";
import type { ToolRef } from "../installers/agent-linker.js";

export async function unlinkCommand(
  type?: string,
  name?: string,
  opts?: { from?: string },
) {
  p.intro(pc.bgCyan(pc.black(" kitn unlink ")));

  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  // --- Resolve type ---
  if (type && type !== "tool") {
    p.log.error(
      `Unsupported type "${type}". Only ${pc.bold("tool")} is supported.`,
    );
    process.exit(1);
  }

  // --- Resolve tool ---
  let toolName = name;

  if (!toolName) {
    const tools = await listTools(config, cwd);
    if (tools.length === 0) {
      p.log.error("No tools found in your project.");
      process.exit(1);
    }

    const selected = await p.select({
      message: "Select a tool to unlink:",
      options: tools.map((t) => ({
        value: t.name,
        label: t.name,
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    toolName = selected as string;
  }

  const tool = await resolveToolByName(toolName, config, cwd);
  if (!tool) {
    p.log.error(
      `Tool "${toolName}" not found. Check that the file exists in your tools directory.`,
    );
    process.exit(1);
  }

  // --- Resolve agent ---
  let agentName = opts?.from;

  if (!agentName) {
    const agents = await listAgents(config, cwd);
    if (agents.length === 0) {
      p.log.error("No agents found in your project.");
      process.exit(1);
    }

    const selected = await p.select({
      message: "Select an agent to unlink the tool from:",
      options: agents.map((a) => ({
        value: a.name,
        label: a.name,
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    agentName = selected as string;
  }

  const agent = await resolveAgentByName(agentName, config, cwd);
  if (!agent) {
    p.log.error(
      `Agent "${agentName}" not found. Check that the file exists in your agents directory.`,
    );
    process.exit(1);
  }

  // --- Perform the unlink ---
  const agentContent = await readFile(agent.filePath, "utf-8");
  const toolRef: ToolRef = {
    exportName: tool.exportName,
    importPath: tool.importPath,
  };

  const result = unlinkToolFromAgent(agentContent, toolRef);

  if (result.error) {
    p.log.warn(result.error);
    p.outro("Could not auto-unlink. Follow the manual instructions above.");
    process.exit(1);
  }

  if (!result.changed) {
    p.log.info(
      `${pc.cyan(tool.exportName)} is not linked to ${pc.cyan(basename(agent.filePath))}.`,
    );
    p.outro("Nothing to do.");
    return;
  }

  await writeFile(agent.filePath, result.content);

  p.log.success(
    `Unlinked ${pc.cyan(tool.exportName)} from ${pc.cyan(basename(agent.filePath))}`,
  );
  p.log.message(
    `  ${pc.red("-")} import { ${tool.exportName} } from "${tool.importPath}"`,
  );
  p.log.message(
    `  ${pc.red("-")} tools: { ${tool.exportName} }`,
  );

  p.outro("Done!");
}
