import { tool } from "ai";
import { z } from "zod";
import vm from "node:vm";

const SYSTEM_PROMPT = `You are a coding agent that writes and executes JavaScript code to solve problems.

When asked to solve a problem:
1. Write clear, well-commented JavaScript code
2. Use the executeCode tool to run it
3. Analyze the output and present the results

Guidelines:
- Write pure JavaScript (no imports/requires)
- Use console.log() for output
- Keep code concise and focused
- Handle edge cases
- The execution environment is sandboxed with no file system or network access`;

const executeCodeTool = tool({
  description:
    "Execute JavaScript code in a sandboxed environment. Use console.log() for output.",
  inputSchema: z.object({
    code: z.string().describe("JavaScript code to execute"),
    description: z
      .string()
      .optional()
      .describe("Brief description of what the code does"),
  }),
  execute: async ({ code, description }) => {
    const logs: string[] = [];
    const errors: string[] = [];

    const sandbox = {
      console: {
        log: (...args: unknown[]) =>
          logs.push(args.map(String).join(" ")),
        error: (...args: unknown[]) =>
          errors.push(args.map(String).join(" ")),
        warn: (...args: unknown[]) =>
          logs.push(`[warn] ${args.map(String).join(" ")}`),
      },
      Math,
      Date,
      JSON,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
      Error,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
    };

    try {
      const context = vm.createContext(sandbox);
      const result = vm.runInNewContext(code, context, {
        timeout: 5000,
        displayErrors: true,
      });

      return {
        success: true,
        description: description ?? "Code execution",
        output: logs.join("\n"),
        errors: errors.length > 0 ? errors.join("\n") : undefined,
        returnValue: result !== undefined ? String(result) : undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        description: description ?? "Code execution",
        output: logs.join("\n"),
        error: err.message,
      };
    }
  },
});

export const CODING_AGENT_CONFIG = {
  system: SYSTEM_PROMPT,
  tools: { executeCode: executeCodeTool },
};
