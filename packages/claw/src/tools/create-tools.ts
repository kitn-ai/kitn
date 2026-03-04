import { tool } from "ai";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { CLAW_HOME } from "../config/io.js";

const WORKSPACE = join(CLAW_HOME, "workspace");

export const createToolTool = tool({
  description:
    "Create a new tool that KitnClaw can use. Provide the tool's name, description, " +
    "input parameter schema (as a Zod schema string), and the execute function body. " +
    "The tool will be auto-registered and available after hot-reload.",
  inputSchema: z.object({
    name: z.string().describe("Tool name in kebab-case (e.g. 'weather-lookup')"),
    description: z.string().describe("Human-readable description of what the tool does"),
    parameters: z.string().describe(
      'Zod schema fields as a string, e.g. \'{ city: z.string().describe("City name"), units: z.enum(["c","f"]).default("c") }\'',
    ),
    executeBody: z.string().describe(
      "The async function body that receives the parsed input. " +
      "Use `input.paramName` to access parameters. Must return a value. " +
      "Can use fetch(), fs, child_process, etc.",
    ),
  }),
  execute: async ({ name, description, parameters, executeBody }) => {
    const source = `import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

const ${camelCase(name)} = tool({
  description: ${JSON.stringify(description)},
  inputSchema: z.object(${parameters}),
  execute: async (input) => {
${indent(executeBody, 4)}
  },
});

registerTool({
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  inputSchema: ${camelCase(name)}.inputSchema,
  tool: ${camelCase(name)},
});
`;

    const dir = join(WORKSPACE, "tools");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${name}.ts`);
    await writeFile(filePath, source, "utf-8");

    return {
      created: true,
      name,
      path: filePath,
      note: "Tool will be registered after hot-reload.",
    };
  },
});

export const createAgentTool = tool({
  description:
    "Create a new agent that KitnClaw can delegate to. " +
    "Provide the agent name, description, system prompt, and which existing tools it should use.",
  inputSchema: z.object({
    name: z.string().describe("Agent name in kebab-case (e.g. 'research-agent')"),
    description: z.string().describe("What the agent specializes in"),
    system: z.string().describe("System prompt that defines the agent's behavior and expertise"),
    toolNames: z.array(z.string()).describe("Names of existing registered tools this agent can use"),
  }),
  execute: async ({ name, description, system, toolNames }) => {
    const source = `import { registerAgent } from "@kitn/core";

registerAgent({
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  system: ${JSON.stringify(system)},
  tools: {}, // Tools are resolved by name from the registry at runtime
});
`;

    const dir = join(WORKSPACE, "agents");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${name}.ts`);
    await writeFile(filePath, source, "utf-8");

    return {
      created: true,
      name,
      path: filePath,
      toolNames,
      note: "Agent will be registered after hot-reload.",
    };
  },
});

function camelCase(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim() ? pad + line : line))
    .join("\n");
}
