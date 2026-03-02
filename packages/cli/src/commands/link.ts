import * as p from "@clack/prompts";
import pc from "picocolors";
import { basename } from "path";
import { listTools, listAgents, linkToolInProject } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function linkCommand(
  type?: string,
  name?: string,
  opts?: { to?: string; as?: string },
) {
  p.intro(pc.bgCyan(pc.black(" kitn link ")));

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

  // --- Perform the link ---
  try {
    const result = await linkToolInProject({
      toolName,
      agentName,
      cwd,
      alias: opts?.as,
    });

    if (result.error) {
      p.log.warn(result.error);
      p.outro("Could not auto-link. Follow the manual instructions above.");
      process.exit(1);
    }

    if (!result.changed) {
      p.log.info(
        `${pc.cyan(result.toolExportName)} is already linked to ${pc.cyan(basename(result.agentFile))}.`,
      );
      p.outro("Nothing to do.");
      return;
    }

    p.log.success(
      `Linked ${pc.cyan(result.toolExportName)} to ${pc.cyan(basename(result.agentFile))}`,
    );
    p.log.message(
      `  ${pc.green("+")} import { ${result.toolExportName} } from "${result.toolImportPath}"`,
    );
    p.log.message(
      `  ${pc.green("+")} tools: { ${opts?.as ? `${opts.as}: ${result.toolExportName}` : result.toolExportName} }`,
    );

    p.outro("Done!");
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }
}
