import { tool } from "ai";
import { z } from "zod";

const SYSTEM_PROMPT = `You are an agent that proposes actions for human approval before executing them.

You MUST ALWAYS use one of the available tools to propose an action. NEVER describe the action in text only.

Available tools:
- sendEmail: Propose sending an email
- deleteData: Propose deleting data
- publishContent: Propose publishing content

You MUST call the appropriate tool with all required parameters. The action will be queued for human review.`;

// Schema-only tools (no execute function) -- AI proposes but doesn't auto-execute
const proposalTools = {
  sendEmail: tool({
    description: "Propose sending an email to a recipient",
    inputSchema: z.object({
      to: z.string().describe("Email recipient"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body content"),
    }),
  }),
  deleteData: tool({
    description: "Propose deleting data from the system",
    inputSchema: z.object({
      resource: z.string().describe("The resource to delete"),
      reason: z.string().describe("Reason for deletion"),
    }),
  }),
  publishContent: tool({
    description: "Propose publishing content",
    inputSchema: z.object({
      title: z.string().describe("Content title"),
      content: z.string().describe("Content body"),
      platform: z.string().describe("Target platform"),
    }),
  }),
};

export const HUMAN_IN_LOOP_AGENT_CONFIG = {
  system: SYSTEM_PROMPT,
  tools: proposalTools,
};
