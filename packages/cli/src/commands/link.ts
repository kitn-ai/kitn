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
import { linkToolToAgent } from "../installers/agent-linker.js";
import type { ToolRef } from "../installers/agent-linker.js";

export async function linkCommand(
  type?: string,
  name?: string,
  opts?: { to?: string; as?: string },
) {
  p.intro(pc.bgCyan(pc.black(" kitn link ")));

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
      message: "Select a tool to link:",
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
  let agentName = opts?.to;

  if (!agentName) {
    const agents = await listAgents(config, cwd);
    if (agents.length === 0) {
      p.log.error("No agents found in your project.");
      process.exit(1);
    }

    const selected = await p.select({
      message: "Select an agent to link the tool to:",
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

  // --- Perform the link ---
  const agentContent = await readFile(agent.filePath, "utf-8");
  const toolRef: ToolRef = {
    exportName: tool.exportName,
    importPath: tool.importPath,
  };

  const result = linkToolToAgent(agentContent, toolRef, opts?.as);

  if (result.error) {
    p.log.warn(result.error);
    p.outro("Could not auto-link. Follow the manual instructions above.");
    process.exit(1);
  }

  if (!result.changed) {
    p.log.info(
      `${pc.cyan(tool.exportName)} is already linked to ${pc.cyan(basename(agent.filePath))}.`,
    );
    p.outro("Nothing to do.");
    return;
  }

  await writeFile(agent.filePath, result.content);

  p.log.success(
    `Linked ${pc.cyan(tool.exportName)} to ${pc.cyan(basename(agent.filePath))}`,
  );
  p.log.message(
    `  ${pc.green("+")} import { ${tool.exportName} } from "${tool.importPath}"`,
  );
  p.log.message(
    `  ${pc.green("+")} tools: { ${opts?.as ? `${opts.as}: ${tool.exportName}` : tool.exportName} }`,
  );

  p.outro("Done!");
}
