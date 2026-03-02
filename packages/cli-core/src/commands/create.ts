import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, relative, dirname } from "path";
import { readConfig } from "../config/io.js";
import { getInstallPath } from "../types/config.js";
import { toCamelCase, toTitleCase } from "../utils/naming.js";
import { createBarrelFile, addImportToBarrel } from "../installers/barrel-manager.js";

const VALID_TYPES = ["agent", "tool", "skill", "storage", "cron"] as const;
type CreateComponentType = (typeof VALID_TYPES)[number];

const typeToKitnType: Record<
  CreateComponentType,
  "kitn:agent" | "kitn:tool" | "kitn:skill" | "kitn:storage" | "kitn:cron"
> = {
  agent: "kitn:agent",
  tool: "kitn:tool",
  skill: "kitn:skill",
  storage: "kitn:storage",
  cron: "kitn:cron",
};

/** Types that get auto-wired into the barrel file. */
const BARREL_TYPES: CreateComponentType[] = ["agent", "tool", "skill", "cron"];

export interface CreateComponentOpts {
  type: string;
  name: string;
  cwd: string;
  overwrite?: boolean;
}

export interface CreateComponentResult {
  filePath: string;
  barrelUpdated: boolean;
  alreadyExists: boolean;
  source: string;
}

export function generateAgentSource(name: string): string {
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

export function generateToolSource(name: string): string {
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

export function generateSkillSource(name: string): string {
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

export function generateStorageSource(name: string): string {
  const camel = toCamelCase("create-" + name);
  return `import type { StorageProvider } from "@kitn/core";

export function ${camel}(config?: Record<string, unknown>): StorageProvider {
  // TODO: implement storage provider
  throw new Error("Not implemented");
}
`;
}

export function generateCronSource(name: string): string {
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

/**
 * Check if a component file already exists at its expected path.
 * Returns the full file path if it exists, null otherwise.
 */
export async function componentFileExists(
  type: string,
  name: string,
  opts?: { cwd?: string },
): Promise<string | null> {
  if (!VALID_TYPES.includes(type as CreateComponentType)) return null;
  const cwd = opts?.cwd ?? process.cwd();
  const config = await readConfig(cwd);
  if (!config) return null;

  const validType = type as CreateComponentType;
  const kitnType = typeToKitnType[validType];
  const fileName = validType === "skill" ? `${name}.md` : `${name}.ts`;
  const filePath = join(cwd, getInstallPath(config, kitnType, fileName));

  return existsSync(filePath) ? filePath : null;
}

/**
 * Create a component file in a kitn project.
 *
 * Pure logic — no interactive prompts. When the file already exists and
 * `overwrite` is false, returns `{ alreadyExists: true }` instead of prompting.
 */
export async function createComponent(opts: CreateComponentOpts): Promise<CreateComponentResult> {
  const { type, name, cwd, overwrite } = opts;

  if (!VALID_TYPES.includes(type as CreateComponentType)) {
    throw new Error(
      `Invalid component type: "${type}". Valid types: ${VALID_TYPES.join(", ")}`,
    );
  }

  const config = await readConfig(cwd);
  if (!config) {
    throw new Error(`No kitn.json found in ${cwd}. Run "kitn init" first.`);
  }

  const validType = type as CreateComponentType;
  const kitnType = typeToKitnType[validType];
  const fileName = validType === "skill" ? `${name}.md` : `${name}.ts`;
  const filePath = join(cwd, getInstallPath(config, kitnType, fileName));

  // Check if file exists
  const alreadyExists = existsSync(filePath);
  if (alreadyExists && !overwrite) {
    return { filePath, barrelUpdated: false, alreadyExists: true, source: "" };
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

  // Write component file
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, source);

  // Wire into barrel file for agents, tools, skills, and crons
  let barrelUpdated = false;
  if (BARREL_TYPES.includes(validType)) {
    const baseDir = config.aliases.base ?? "src/ai";
    const barrelPath = join(cwd, baseDir, "index.ts");

    let barrelContent: string;
    if (existsSync(barrelPath)) {
      barrelContent = await readFile(barrelPath, "utf-8");
    } else {
      barrelContent = createBarrelFile();
      await mkdir(join(cwd, baseDir), { recursive: true });
    }

    const importPath =
      "./" + relative(join(cwd, baseDir), filePath).replace(/\.ts$/, ".js");
    const updatedBarrel = addImportToBarrel(barrelContent, importPath);

    if (updatedBarrel !== barrelContent) {
      await writeFile(barrelPath, updatedBarrel);
      barrelUpdated = true;
    }
  }

  return { filePath, barrelUpdated, alreadyExists: false, source };
}
