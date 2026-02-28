import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "@kitnai/core";

const jobSchema = z.object({
  id: z.string(),
  agentName: z.string(),
  input: z.string(),
  conversationId: z.string(),
  scopeId: z.string().optional(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  result: z.string().optional(),
  error: z.string().optional(),
  usage: z
    .object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
  toolsUsed: z.array(z.string()).optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

const errorSchema = z.object({ error: z.string() });

export function createJobRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();
  const store = ctx.storage.jobs;

  // GET / — List jobs
  router.openapi(
    createRoute({
      method: "get",
      path: "/",
      tags: ["Jobs"],
      summary: "List all background jobs",
      responses: {
        200: {
          description: "List of jobs",
          content: {
            "application/json": {
              schema: z.object({
                jobs: z.array(jobSchema),
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

  // GET /{id} — Get job
  router.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      tags: ["Jobs"],
      summary: "Get a background job by ID",
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        200: {
          description: "Job details",
          content: { "application/json": { schema: jobSchema } },
        },
        404: {
          description: "Not found",
          content: { "application/json": { schema: errorSchema } },
        },
      },
    }),
    (async (c: any) => {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: `Job not found: ${id}` }, 404);
      return c.json(job);
    }) as any,
  );

  // POST /{id}/cancel — Cancel a running or queued job
  router.openapi(
    createRoute({
      method: "post",
      path: "/{id}/cancel",
      tags: ["Jobs"],
      summary: "Cancel a running or queued job",
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        200: {
          description: "Cancelled job",
          content: { "application/json": { schema: jobSchema } },
        },
        404: {
          description: "Not found",
          content: { "application/json": { schema: errorSchema } },
        },
        409: {
          description: "Job is not cancellable",
          content: { "application/json": { schema: errorSchema } },
        },
      },
    }),
    (async (c: any) => {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: `Job not found: ${id}` }, 404);

      if (job.status !== "queued" && job.status !== "running") {
        return c.json(
          { error: `Job ${id} is not running or queued (status: ${job.status})` },
          409,
        );
      }

      const updated = await store.update(id, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });

      return c.json(updated);
    }) as any,
  );

  // DELETE /{id} — Delete a job record
  router.openapi(
    createRoute({
      method: "delete",
      path: "/{id}",
      tags: ["Jobs"],
      summary: "Delete a background job record",
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        200: {
          description: "Job deleted",
          content: {
            "application/json": {
              schema: z.object({ deleted: z.boolean() }),
            },
          },
        },
        404: {
          description: "Not found",
          content: { "application/json": { schema: errorSchema } },
        },
      },
    }),
    (async (c: any) => {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const deleted = await store.delete(id, scopeId);
      if (!deleted) return c.json({ error: `Job not found: ${id}` }, 404);
      return c.json({ deleted: true });
    }) as any,
  );

  return router;
}
