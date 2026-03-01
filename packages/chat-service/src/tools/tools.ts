import { z } from "zod";
import { tool } from "ai";

const askUserItemSchema = z.object({
  type: z.enum(["question", "option", "confirmation", "info", "warning"]),
  text: z.string().describe("The question or message to show the user"),
  choices: z.array(z.string()).optional().describe("Required when type is 'option'"),
  context: z.string().optional().describe("Additional context for why this is being asked"),
});

export const askUserTool = tool({
  description:
    "Ask the user a question or show them information. " +
    "Use 'option' for multiple choice (preferred), 'question' for free text, " +
    "'confirmation' for yes/no, 'info' for status updates, 'warning' for risk flags. " +
    "Prefer options over free-text questions when possible.",
  parameters: z.object({
    items: z.array(askUserItemSchema).describe("Questions or messages to show"),
  }),
});

export const writeFileTool = tool({
  description:
    "Write content to a file in the user's project. Use for generated code, " +
    "prompt files, or configuration. The user will see a preview before confirmation.",
  parameters: z.object({
    path: z.string().describe("Relative path from project root (e.g. 'src/agents/weather-agent.ts')"),
    content: z.string().describe("The full file content to write"),
    description: z.string().optional().describe("Brief description of what was generated"),
  }),
});

export const readFileTool = tool({
  description:
    "Read a file from the user's project to understand existing code. " +
    "Use before updating components to match the user's code style.",
  parameters: z.object({
    path: z.string().describe("Relative path from project root"),
  }),
});

export const listFilesTool = tool({
  description:
    "List files in the user's project matching a glob pattern. " +
    "Use to discover what components exist in the project.",
  parameters: z.object({
    pattern: z.string().describe("Glob pattern (e.g. '**/*.ts', 'src/agents/*.ts')"),
    directory: z.string().optional().describe("Directory to search in, relative to project root"),
  }),
});

export const updateEnvTool = tool({
  description:
    "Prompt the user for an environment variable value and write it to .env. " +
    "The actual value is NEVER returned to the conversation — only a success confirmation. " +
    "Use for API keys, secrets, and sensitive configuration.",
  parameters: z.object({
    key: z.string().describe("Environment variable name (e.g. 'OPENWEATHER_API_KEY')"),
    description: z.string().describe("Description shown to the user when prompting for the value"),
  }),
});
