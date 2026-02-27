import * as p from "@clack/prompts";
import pc from "picocolors";
import { join } from "path";
import { mkdir, writeFile } from "fs/promises";

const VALID_TYPES = ["agent", "tool", "skill", "storage"] as const;
type ComponentType = (typeof VALID_TYPES)[number];

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function toTitleCase(str: string): string {
  return str
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function generateRegistryJson(
  type: ComponentType,
  name: string,
  sourceFile: string
): object {
  const base: Record<string, unknown> = {
    $schema: "https://kitn.dev/schema/registry.json",
    name,
    type: `kitn:${type}`,
    version: "0.1.0",
    description: "",
    files: [sourceFile],
    categories: [],
  };

  if (type === "tool") {
    base.dependencies = ["ai", "zod"];
  } else if (type === "agent" || type === "storage") {
    base.dependencies = [];
  }

  return base;
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
  parameters: z.object({
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
  inputSchema: z.object({ input: z.string() }),
  tool: ${camel},
});
`;
}

function generateSkillSource(name: string): string {
  const title = toTitleCase(name);
  return `---
name: ${name}
description: ""
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

async function dirExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import("fs/promises");
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function createComponent(
  type: string,
  name: string,
  opts?: { cwd?: string }
): Promise<{ dir: string; files: string[] }> {
  if (!VALID_TYPES.includes(type as ComponentType)) {
    throw new Error(
      `Invalid component type: "${type}". Valid types: ${VALID_TYPES.join(", ")}`
    );
  }

  const cwd = opts?.cwd ?? process.cwd();
  const dir = join(cwd, name);

  if (await dirExists(dir)) {
    throw new Error(`Directory "${name}" already exists`);
  }

  await mkdir(dir, { recursive: true });

  const validType = type as ComponentType;
  const sourceFile = validType === "skill" ? "README.md" : `${name}.ts`;
  const registryJson = generateRegistryJson(validType, name, sourceFile);

  await writeFile(
    join(dir, "registry.json"),
    JSON.stringify(registryJson, null, 2) + "\n"
  );

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
  }

  await writeFile(join(dir, sourceFile), source);

  return { dir, files: ["registry.json", sourceFile] };
}

export async function createCommand(type: string, name: string) {
  p.intro(pc.bgCyan(pc.black(" kitn create ")));

  try {
    const { dir, files } = await createComponent(type, name);

    p.log.success(`Created ${pc.bold(type)} component ${pc.cyan(name)}`);
    for (const file of files) {
      p.log.message(`  ${pc.green("+")} ${file}`);
    }

    const editFile = files.find((f) => f !== "registry.json") ?? files[0];
    p.outro(
      `Edit ${pc.cyan(`${name}/${editFile}`)}, then run ${pc.bold("kitn build")}`
    );
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }
}
