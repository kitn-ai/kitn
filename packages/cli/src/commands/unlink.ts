import * as p from "@clack/prompts";
import pc from "picocolors";
import { basename } from "path";
import { listTools, listAgents, unlinkToolInProject } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function unlinkCommand(
  type?: string,
  name?: string,
  opts?: { from?: string },
) {
  p.intro(pc.bgCyan(pc.black(" kitn unlink ")));

  let cwd = process.cwd();
  let config;
  ({ config, cwd } = await requireConfig(cwd));

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

  // --- Perform the unlink ---
  try {
    const result = await unlinkToolInProject({ toolName, agentName, cwd });

    if (result.error) {
      p.log.warn(result.error);
      p.outro("Could not auto-unlink. Follow the manual instructions above.");
      process.exit(1);
    }

    if (!result.changed) {
      p.log.info(
        `${pc.cyan(result.toolExportName)} is not linked to ${pc.cyan(basename(result.agentFile))}.`,
      );
      p.outro("Nothing to do.");
      return;
    }

    p.log.success(
      `Unlinked ${pc.cyan(result.toolExportName)} from ${pc.cyan(basename(result.agentFile))}`,
    );
    p.log.message(
      `  ${pc.red("-")} import { ${result.toolExportName} } from "${result.toolImportPath}"`,
    );
    p.log.message(
      `  ${pc.red("-")} tools: { ${result.toolExportName} }`,
    );

    p.outro("Done!");
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }
}
