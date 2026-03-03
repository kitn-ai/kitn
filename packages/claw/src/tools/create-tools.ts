import { tool } from "ai";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { CLAW_HOME } from "../config/io.js";

const WORKSPACE = join(CLAW_HOME, "workspace");

export const createToolTool = tool({
  description: "Create a new tool by writing a TypeScript source file to the workspace. The tool will be available after hot-reload.",
  inputSchema: z.object({
    name: z.string().describe("Tool name (kebab-case, e.g. 'weather-lookup')"),
    description: z.string().describe("What the tool does"),
    sourceCode: z.string().describe("Complete TypeScript source code for the tool"),
  }),
  execute: async ({ name, description, sourceCode }) => {
    const dir = join(WORKSPACE, "tools");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${name}.ts`);
    await writeFile(filePath, sourceCode, "utf-8");
    return {
      created: true,
      name,
      path: filePath,
      note: "Tool will be available after hot-reload picks it up.",
    };
  },
});

export const createAgentTool = tool({
  description: "Create a new agent by writing a TypeScript source file to the workspace. The agent will be available after hot-reload.",
  inputSchema: z.object({
    name: z.string().describe("Agent name (kebab-case, e.g. 'research-agent')"),
    description: z.string().describe("What the agent does"),
    sourceCode: z.string().describe("Complete TypeScript source code for the agent"),
  }),
  execute: async ({ name, description, sourceCode }) => {
    const dir = join(WORKSPACE, "agents");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${name}.ts`);
    await writeFile(filePath, sourceCode, "utf-8");
    return {
      created: true,
      name,
      path: filePath,
      note: "Agent will be available after hot-reload picks it up.",
    };
  },
});
