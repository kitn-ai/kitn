import { z } from "zod";
import "@asteasolutions/zod-to-openapi";

export const agentRequestSchema = z.object({
  message: z.string().min(1).openapi({ example: "Hello, how can you help me?" }),
  conversationId: z.string().optional(),
  model: z.string().optional().openapi({ example: "openai/gpt-4o-mini" }),
  memoryIds: z.array(z.string()).optional().openapi({
    example: ["user-123"],
    description: "Memory namespace IDs to load as context",
  }),
  planMode: z.boolean().optional().openapi({
    description: "Force plan-only mode (orchestrator creates tasks but waits for approval before executing)",
  }),
  approvedPlan: z.array(z.object({
    agent: z.string(),
    query: z.string(),
    skills: z.array(z.string()).optional(),
  })).optional().openapi({
    description: "Pre-approved task plan to execute immediately",
  }),
  autonomous: z.boolean().optional().openapi({
    description: "Per-request override for autonomous mode (when false, orchestrator may ask user for input)",
  }),
});

export const agentResponseSchema = z.object({
  response: z.string(),
  conversationId: z.string(),
  toolsUsed: z.array(z.string()),
});

export const approveRequestSchema = z.object({
  id: z.string().min(1).openapi({ example: "action_123_abc" }),
  approved: z.boolean().openapi({ example: true }),
});

export const agentPatchSchema = z.object({
  system: z.string().optional().openapi({
    example: "You are a helpful assistant.",
    description: "New system prompt to use for this agent",
  }),
  reset: z.boolean().optional().openapi({
    example: true,
    description: "Reset system prompt to default",
  }),
});
