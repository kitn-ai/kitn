import { Elysia } from "elysia";
import type { PluginContext } from "@kitnai/core";

export function createJobRoutes(ctx: PluginContext) {
  const store = ctx.storage.jobs;

  return new Elysia({ prefix: "/jobs" })
    .get("/", async ({ headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const jobs = await store.list(scopeId);
      return { jobs, count: jobs.length };
    })
    .get("/:id", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const job = await store.get(params.id, scopeId);
      if (!job) return status(404, { error: `Job not found: ${params.id}` });
      return job;
    })
    .post("/:id/cancel", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const job = await store.get(params.id, scopeId);
      if (!job) return status(404, { error: `Job not found: ${params.id}` });

      if (job.status !== "queued" && job.status !== "running") {
        return status(409, { error: `Job ${params.id} is not running or queued (status: ${job.status})` });
      }

      const updated = await store.update(params.id, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });

      return updated;
    })
    .delete("/:id", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const deleted = await store.delete(params.id, scopeId);
      if (!deleted) return status(404, { error: `Job not found: ${params.id}` });
      return { deleted: true };
    });
}
