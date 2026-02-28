import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "@kitnai/core";
import { executeCronJob } from "@kitnai/core";

const cronJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  schedule: z.string().optional(),
  runAt: z.string().optional(),
  agentName: z.string(),
  input: z.string(),
  model: z.string().optional(),
  timezone: z.string().optional(),
  enabled: z.boolean(),
  nextRun: z.string().optional(),
  lastRun: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const cronExecutionSchema = z.object({
  id: z.string(),
  cronId: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: z.enum(["running", "completed", "failed"]),
  summary: z.string().optional(),
  error: z.string().optional(),
});

const cronInputSchema = cronJobSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export function createCronRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();
  const store = ctx.storage.crons;

  // GET / — List crons
  router.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["Crons"],
      summary: "List all cron jobs",
      responses: {
        200: {
          description: "List of cron jobs",
          content: {
            "application/json": {
              schema: z.object({
                jobs: z.array(cronJobSchema),
                count: z.number(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const jobs = await store.list(scopeId);
      return c.json({ jobs, count: jobs.length });
    },
  );

  // POST / — Create cron
  router.openapi(
    createRoute({
      method: "post",
      path: "/",
      tags: ["Crons"],
      summary: "Create a cron job",
      request: {
        body: {
          content: { "application/json": { schema: cronInputSchema } },
        },
      },
      responses: {
        201: {
          description: "Cron job created",
          content: { "application/json": { schema: cronJobSchema } },
        },
      },
    }),
    async (c) => {
      const body = await c.req.json();
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.create(body, scopeId);

      // Sync with scheduler if configured
      if (ctx.cronScheduler) {
        await ctx.cronScheduler.schedule(job, `/crons/${job.id}/run`);
      }

      return c.json(job, 201);
    },
  );

  // POST /tick — Execute due crons
  router.openapi(
    createRoute({
      method: "post",
      path: "/tick",
      tags: ["Crons"],
      summary: "Execute all due cron jobs",
      responses: {
        200: {
          description: "Execution results",
          content: {
            "application/json": {
              schema: z.object({
                executed: z.number(),
                results: z.array(
                  z.object({
                    cronId: z.string(),
                    name: z.string(),
                    status: z.enum(["running", "completed", "failed"]),
                  }),
                ),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const dueJobs = await store.getDueJobs(new Date(), scopeId);
      const results = [];
      for (const job of dueJobs) {
        const execution = await executeCronJob(ctx, job, scopeId);
        results.push({ cronId: job.id, name: job.name, status: execution.status });
      }
      return c.json({ executed: results.length, results });
    },
  );

  // GET /{id} — Get cron
  router.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["Crons"],
      summary: "Get a cron job by ID",
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        200: {
          description: "Cron job details",
          content: { "application/json": { schema: cronJobSchema } },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": { schema: z.object({ error: z.string() }) },
          },
        },
      },
    }),
    (async (c: any) => {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: `Cron job not found: ${id}` }, 404);
      return c.json(job);
    }) as any,
  );

  // PATCH /{id} — Update cron
  router.openapi(
    createRoute({
      method: "patch",
      path: "/{id}",
      tags: ["Crons"],
      summary: "Update a cron job",
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: {
            "application/json": { schema: cronInputSchema.partial() },
          },
        },
      },
      responses: {
        200: {
          description: "Updated cron job",
          content: { "application/json": { schema: cronJobSchema } },
        },
      },
    }),
    (async (c: any) => {
      const id = c.req.param("id");
      const body = await c.req.json();
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.update(id, body, scopeId);

      // Sync with scheduler if configured
      if (ctx.cronScheduler) {
        if (ctx.cronScheduler.update) {
          await ctx.cronScheduler.update(job, `/crons/${job.id}/run`);
        } else {
          await ctx.cronScheduler.unschedule(id);
          if (job.enabled) {
            await ctx.cronScheduler.schedule(job, `/crons/${job.id}/run`);
          }
        }
      }

      return c.json(job);
    }) as any,
  );

  // DELETE /{id} — Delete cron
  router.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["Crons"],
      summary: "Delete a cron job",
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        200: {
          description: "Cron job deleted",
          content: {
            "application/json": {
              schema: z.object({ deleted: z.boolean() }),
            },
          },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": { schema: z.object({ error: z.string() }) },
          },
        },
      },
    }),
    (async (c: any) => {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;

      if (ctx.cronScheduler) {
        await ctx.cronScheduler.unschedule(id);
      }

      const deleted = await store.delete(id, scopeId);
      if (!deleted) return c.json({ error: `Cron job not found: ${id}` }, 404);
      return c.json({ deleted: true });
    }) as any,
  );

  // POST /{id}/run — Execute specific cron
  router.openapi(
    createRoute({
      method: "post",
      path: "/{id}/run",
      tags: ["Crons"],
      summary: "Execute a specific cron job immediately",
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        200: {
          description: "Execution result",
          content: { "application/json": { schema: cronExecutionSchema } },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": { schema: z.object({ error: z.string() }) },
          },
        },
      },
    }),
    (async (c: any) => {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: `Cron job not found: ${id}` }, 404);

      const execution = await executeCronJob(ctx, job, scopeId);
      return c.json(execution);
    }) as any,
  );

  // GET /{id}/history — Get execution history
  router.openapi(
    createRoute({
      method: "get",
      path: "/{id}/history",
      tags: ["Crons"],
      summary: "Get execution history for a cron job",
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        200: {
          description: "Execution history",
          content: {
            "application/json": {
              schema: z.object({
                executions: z.array(cronExecutionSchema),
                count: z.number(),
              }),
            },
          },
        },
      },
    }),
    (async (c: any) => {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;
      const executions = await store.listExecutions(id, limit, scopeId);
      return c.json({ executions, count: executions.length });
    }) as any,
  );

  return router;
}
