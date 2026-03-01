import * as p from "@clack/prompts";
import pc from "picocolors";
import { join, relative } from "path";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { readConfig, getInstallPath } from "../utils/config.js";
import { toCamelCase, toTitleCase } from "../utils/naming.js";
import { checkFileStatus, FileStatus, writeComponentFile } from "../installers/file-writer.js";
import { createBarrelFile, addImportToBarrel } from "../installers/barrel-manager.js";

const VALID_TYPES = ["agent", "tool", "skill", "storage", "cron"] as const;
type ComponentType = (typeof VALID_TYPES)[number];

/**
 * Check if a component file already exists at its expected path.
 * Returns the full file path if it exists, null otherwise.
 */
export async function componentFileExists(
  type: string,
  name: string,
  opts?: { cwd?: string }
): Promise<string | null> {
  if (!VALID_TYPES.includes(type as ComponentType)) return null;
  const cwd = opts?.cwd ?? process.cwd();
  const config = await readConfig(cwd);
  if (!config) return null;

  const validType = type as ComponentType;
  const kitnType = typeToKitnType[validType];
  const fileName = validType === "skill" ? `${name}.md` : `${name}.ts`;
  const filePath = join(cwd, getInstallPath(config, kitnType, fileName));

  return existsSync(filePath) ? filePath : null;
}

function generateAgentSource(name: string): string {
  const camel = toCamelCase(name);
  return `import { registerAgent } from "@kitn/core";

const SYSTEM_PROMPT = "You are a helpful assistant.";

registerAgent({
  name: "${name}",
  description: "",
  system: SYSTEM_PROMPT,
  tools: {},
});
`;
}

function generateToolSource(name: string): string {
  const camel = toCamelCase(name);
  return `import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const ${camel} = tool({
  description: "",
  inputSchema: z.object({
    input: z.string().describe("Input parameter"),
  }),
  execute: async ({ input }) => {
    // TODO: implement
    return { result: input };
  },
});

registerTool({
  name: "${name}",
  description: "",
  inputSchema: z.object({ input: z.string().describe("Input parameter") }),
  tool: ${camel},
});
`;
}

function generateSkillSource(name: string): string {
  const title = toTitleCase(name);
  return `---
name: ${name}
description: ""
tags: []
phase: both
---

# ${title}

Describe what this skill does and how to use it.
`;
}

function generateStorageSource(name: string): string {
  const camel = toCamelCase("create-" + name);
  return `import type { StorageProvider } from "@kitn/core";

export function ${camel}(config?: Record<string, unknown>): StorageProvider {
  // TODO: implement storage provider
  throw new Error("Not implemented");
}
`;
}

function generateCronSource(name: string): string {
  const camel = toCamelCase(name);
  return `import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

// Cron job: ${name}
// This file defines tools for a cron job. Register the cron via the API:
// POST /api/crons { name: "${name}", schedule: "0 6 * * *", agentName: "...", input: "..." }

export const ${camel} = tool({
  description: "Execute the ${name} cron task",
  inputSchema: z.object({
    input: z.string().describe("Task input"),
  }),
  execute: async ({ input }) => {
    // TODO: implement
    return { result: input };
  },
});

registerTool({
  name: "${name}",
  description: "",
  inputSchema: z.object({ input: z.string().describe("Task input") }),
  tool: ${camel},
});
`;
}

const typeToKitnType: Record<ComponentType, "kitn:agent" | "kitn:tool" | "kitn:skill" | "kitn:storage" | "kitn:cron"> = {
  agent: "kitn:agent",
  tool: "kitn:tool",
  skill: "kitn:skill",
  storage: "kitn:storage",
  cron: "kitn:cron",
};

// Types that get auto-wired into the barrel file
const BARREL_TYPES: ComponentType[] = ["agent", "tool", "skill", "cron"];

export async function createComponentInProject(
  type: string,
  name: string,
  opts?: { cwd?: string; overwrite?: boolean }
): Promise<{ filePath: string; barrelUpdated: boolean }> {
  if (!VALID_TYPES.includes(type as ComponentType)) {
    throw new Error(
      `Invalid component type: "${type}". Valid types: ${VALID_TYPES.join(", ")}`
    );
  }

  const cwd = opts?.cwd ?? process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    throw new Error(
      `No kitn.json found in ${cwd}. Run ${pc.bold("kitn init")} first.`
    );
  }

  const validType = type as ComponentType;
  const kitnType = typeToKitnType[validType];
  const fileName = validType === "skill" ? `${name}.md` : `${name}.ts`;

  const filePath = join(cwd, getInstallPath(config, kitnType, fileName));

  // Check file doesn't already exist
  const dummyContent = ""; // only need to check existence
  const status = await checkFileStatus(filePath, dummyContent);
  if (status !== FileStatus.New && !opts?.overwrite) {
    const shouldOverwrite = await p.confirm({
      message: `${pc.yellow("File already exists:")} ${filePath}\n  Overwrite it with a fresh scaffold?`,
    });
    if (p.isCancel(shouldOverwrite) || !shouldOverwrite) {
      throw new Error(`Skipped — ${filePath} already exists.`);
    }
  }

  // Generate source
  let source: string;
  switch (validType) {
    case "agent":
      source = generateAgentSource(name);
      break;
    case "tool":
      source = generateToolSource(name);
      break;
    case "skill":
      source = generateSkillSource(name);
      break;
    case "storage":
      source = generateStorageSource(name);
      break;
    case "cron":
      source = generateCronSource(name);
      break;
  }

  // Write the component file
  await writeComponentFile(filePath, source);

  // Wire into barrel file for agents, tools, and skills
  let barrelUpdated = false;
  if (BARREL_TYPES.includes(validType)) {
    const baseDir = config.aliases.base ?? "src/ai";
    const barrelPath = join(cwd, baseDir, "index.ts");

    // Read or create barrel file
    let barrelContent: string;
    if (existsSync(barrelPath)) {
      barrelContent = await readFile(barrelPath, "utf-8");
    } else {
      barrelContent = createBarrelFile();
      await mkdir(join(cwd, baseDir), { recursive: true });
    }

    // Compute relative import path from barrel to the component
    const importPath = "./" + relative(join(cwd, baseDir), filePath).replace(/\.ts$/, ".js");
    const updatedBarrel = addImportToBarrel(barrelContent, importPath);

    if (updatedBarrel !== barrelContent) {
      await writeFile(barrelPath, updatedBarrel);
      barrelUpdated = true;
    }
  }

  return { filePath, barrelUpdated };
}

export async function createCommand(type: string, name: string) {
  p.intro(pc.bgCyan(pc.black(" kitn create ")));

  try {
    const { filePath, barrelUpdated } = await createComponentInProject(type, name);

    p.log.success(`Created ${pc.bold(type)} component ${pc.cyan(name)}`);
    p.log.message(`  ${pc.green("+")} ${filePath}`);

    if (barrelUpdated) {
      p.log.message(`  ${pc.green("+")} barrel file updated`);
    }

    p.outro(
      `Edit ${pc.cyan(filePath)} to customize your ${type}.`
    );
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }
}
