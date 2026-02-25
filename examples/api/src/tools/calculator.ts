import { tool } from "ai";
import { z } from "zod";
import type { AIPluginInstance } from "@kitnai/server";

function safeEvaluate(expression: string): number {
  // Only allow numbers, operators, parentheses, spaces, and decimal points
  if (!/^[\d\s+\-*/().%^]+$/.test(expression)) {
    throw new Error(`Invalid expression: "${expression}"`);
  }
  // Replace ^ with ** for exponentiation
  const sanitized = expression.replace(/\^/g, "**");
  // eslint-disable-next-line no-new-func
  const result = new Function(`"use strict"; return (${sanitized})`)();
  if (typeof result !== "number" || !isFinite(result)) {
    throw new Error(`Expression did not produce a finite number: "${expression}"`);
  }
  return result;
}

export const calculatorTool = tool({
  description:
    "Evaluates a mathematical expression and returns the result. Supports +, -, *, /, %, ^ (exponent), and parentheses.",
  inputSchema: z.object({
    expression: z
      .string()
      .describe("Mathematical expression to evaluate (e.g. '2 + 3 * 4')"),
  }),
  execute: async ({ expression }) => {
    const result = safeEvaluate(expression);
    return { expression, result };
  },
});

export function registerCalculatorTool(plugin: AIPluginInstance) {
  plugin.tools.register({
    name: "calculate",
    description: "Evaluates a mathematical expression",
    inputSchema: z.object({ expression: z.string() }),
    tool: calculatorTool,
    directExecute: async (input) => {
      const result = safeEvaluate(input.expression);
      return { expression: input.expression, result };
    },
    category: "utility",
  });
}
