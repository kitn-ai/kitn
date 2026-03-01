import { tool } from "ai";
import { z } from "zod";

const planStepSchema = z.object({
  action: z.enum(["add", "create", "link", "remove", "unlink", "registry-add", "update"]),
  component: z
    .string()
    .optional()
    .describe("Component name for add/remove (e.g. 'weather-tool')"),
  type: z
    .string()
    .optional()
    .describe("Component type for create: 'agent', 'tool', 'skill', 'storage'"),
  name: z
    .string()
    .optional()
    .describe("Component name for create (e.g. 'slack-notify')"),
  description: z
    .string()
    .optional()
    .describe("Description for create (what the component does)"),
  toolName: z.string().optional().describe("Tool name for link/unlink"),
  agentName: z.string().optional().describe("Agent name for link/unlink"),
  namespace: z
    .string()
    .optional()
    .describe("Registry namespace for registry-add (e.g. '@community')"),
  url: z
    .string()
    .optional()
    .describe("Registry URL template for registry-add"),
  reason: z.string().describe("Why this step is needed"),
});

const chatPlanSchema = z.object({
  summary: z
    .string()
    .describe("Brief summary of what the plan will accomplish"),
  steps: z
    .array(planStepSchema)
    .describe("Ordered list of CLI actions to execute"),
});

export type PlanStep = z.infer<typeof planStepSchema>;
export type ChatPlan = z.infer<typeof chatPlanSchema>;

export const createPlanTool = tool({
  description:
    "Create an execution plan of kitn CLI actions. Call this once with the complete plan after analyzing the user's request against the available and installed components.",
  parameters: chatPlanSchema,
  execute: async (input: ChatPlan) => input,
});
