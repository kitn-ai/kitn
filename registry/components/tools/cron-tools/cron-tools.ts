import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

// ── Schemas ──

const listCronsSchema = z.object({});

const createCronSchema = z.object({
  name: z.string().describe("Unique name for the cron job"),
  description: z.string().describe("What this cron job does"),
  schedule: z
    .string()
    .optional()
    .describe(
      "Cron expression for recurring jobs, e.g. '0 6 * * *' for daily at 6am UTC"
    ),
  runAt: z
    .string()
    .optional()
    .describe(
      "ISO datetime for one-off jobs, e.g. '2026-03-07T17:00:00Z'"
    ),
  agentName: z.string().describe("Name of the agent to invoke"),
  input: z.string().describe("Message to send to the agent"),
  model: z.string().optional().describe("Optional model override"),
  timezone: z
    .string()
    .optional()
    .describe("IANA timezone, e.g. 'America/New_York'. Default: UTC"),
});

const updateCronSchema = z.object({
  id: z.string().describe("The cron job ID to update"),
  enabled: z.boolean().optional().describe("Enable or disable the job"),
  schedule: z.string().optional().describe("New cron expression"),
  input: z.string().optional().describe("New input message"),
});

const deleteCronSchema = z.object({
  id: z.string().describe("The cron job ID to delete"),
});

const listAgentsSchema = z.object({});

// ── Module-level context (set via setCronToolsContext) ──

let _ctx: any = null;

/**
 * Set the PluginContext for the module-level cron tools.
 * Call this after creating your plugin so the registered tools can access storage.
 */
export function setCronToolsContext(ctx: any): void {
  _ctx = ctx;
}

function getCtx(): any {
  if (!_ctx) {
    throw new Error(
      "Cron tools context not set. Call setCronToolsContext(ctx) after creating your plugin."
    );
  }
  return _ctx;
}

// ── Standalone tools (use module-level context) ──

export const listCronsTool = tool({
  description: "List all scheduled cron jobs",
  inputSchema: listCronsSchema,
  execute: async () => {
    const ctx = getCtx();
    const jobs = await ctx.storage.crons.list();
    return {
      jobs: jobs.map((j: any) => ({
        id: j.id,
        name: j.name,
        description: j.description,
        schedule: j.schedule,
        runAt: j.runAt,
        enabled: j.enabled,
        nextRun: j.nextRun,
        agentName: j.agentName,
      })),
    };
  },
});

export const createCronTool = tool({
  description: "Create a new scheduled cron job",
  inputSchema: createCronSchema,
  execute: async (params) => {
    const ctx = getCtx();
    const job = await ctx.storage.crons.create({
      ...params,
      enabled: true,
    });
    return job;
  },
});

export const updateCronTool = tool({
  description: "Update an existing cron job",
  inputSchema: updateCronSchema,
  execute: async ({ id, ...updates }) => {
    const ctx = getCtx();
    const job = await ctx.storage.crons.update(id, updates);
    return job;
  },
});

export const deleteCronTool = tool({
  description: "Delete a cron job",
  inputSchema: deleteCronSchema,
  execute: async ({ id }) => {
    const ctx = getCtx();
    const deleted = await ctx.storage.crons.delete(id);
    return { deleted, id };
  },
});

export const listAgentsTool = tool({
  description: "List all installed agents available for cron jobs",
  inputSchema: listAgentsSchema,
  execute: async () => {
    const ctx = getCtx();
    const agents = ctx.agents.list();
    return {
      agents: agents.map((a: any) => ({
        name: a.name,
        description: a.description,
      })),
    };
  },
});

// ── Factory function (preferred — returns tools bound to a specific context) ──

/**
 * Create cron management tools bound to a PluginContext.
 *
 * Use this when you need tools with context already wired in,
 * e.g. when building an agent's tool set:
 *
 * ```ts
 * const cronTools = createCronTools(ctx);
 * registerAgent({ tools: { ...cronTools } });
 * ```
 */
export function createCronTools(ctx: any) {
  // Also set the module-level context so registered tools work
  _ctx = ctx;

  const listCrons = tool({
    description: "List all scheduled cron jobs",
    inputSchema: listCronsSchema,
    execute: async () => {
      const jobs = await ctx.storage.crons.list();
      return {
        jobs: jobs.map((j: any) => ({
          id: j.id,
          name: j.name,
          description: j.description,
          schedule: j.schedule,
          runAt: j.runAt,
          enabled: j.enabled,
          nextRun: j.nextRun,
          agentName: j.agentName,
        })),
      };
    },
  });

  const createCron = tool({
    description: "Create a new scheduled cron job",
    inputSchema: createCronSchema,
    execute: async (params) => {
      const job = await ctx.storage.crons.create({
        ...params,
        enabled: true,
      });
      return job;
    },
  });

  const updateCron = tool({
    description: "Update an existing cron job",
    inputSchema: updateCronSchema,
    execute: async ({ id, ...updates }) => {
      const job = await ctx.storage.crons.update(id, updates);
      return job;
    },
  });

  const deleteCron = tool({
    description: "Delete a cron job",
    inputSchema: deleteCronSchema,
    execute: async ({ id }) => {
      const deleted = await ctx.storage.crons.delete(id);
      return { deleted, id };
    },
  });

  const listAgents = tool({
    description: "List all installed agents available for cron jobs",
    inputSchema: listAgentsSchema,
    execute: async () => {
      const agents = ctx.agents.list();
      return {
        agents: agents.map((a: any) => ({
          name: a.name,
          description: a.description,
        })),
      };
    },
  });

  return { listCrons, createCron, updateCron, deleteCron, listAgents };
}

// ── Self-registration ──

registerTool({
  name: "list-crons",
  description: "List all scheduled cron jobs",
  inputSchema: listCronsSchema,
  tool: listCronsTool,
});

registerTool({
  name: "create-cron",
  description: "Create a new scheduled cron job",
  inputSchema: createCronSchema,
  tool: createCronTool,
});

registerTool({
  name: "update-cron",
  description: "Update an existing cron job",
  inputSchema: updateCronSchema,
  tool: updateCronTool,
});

registerTool({
  name: "delete-cron",
  description: "Delete a cron job",
  inputSchema: deleteCronSchema,
  tool: deleteCronTool,
});

registerTool({
  name: "list-agents",
  description: "List all installed agents available for cron jobs",
  inputSchema: listAgentsSchema,
  tool: listAgentsTool,
});
