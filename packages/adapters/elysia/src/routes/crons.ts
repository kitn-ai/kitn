import { Elysia } from "elysia";
import type { PluginContext } from "@kitnai/core";
import { executeCronJob } from "@kitnai/core";

export function createCronRoutes(ctx: PluginContext) {
  const store = ctx.storage.crons;

  return new Elysia({ prefix: "/crons" })
    .get("/", async ({ headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const jobs = await store.list(scopeId);
      return { jobs, count: jobs.length };
    })
    .post("/", async ({ body, headers }) => {
      const b = body as any;
      const scopeId = headers["x-scope-id"] || undefined;
      const job = await store.create(b, scopeId);
      if (ctx.cronScheduler) {
        await ctx.cronScheduler.schedule(job, `/crons/${job.id}/run`);
      }
      return job;
    })
    .post("/tick", async ({ headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const dueJobs = await store.getDueJobs(new Date(), scopeId);
      const results = [];
      for (const job of dueJobs) {
        const execution = await executeCronJob(ctx, job, scopeId);
        results.push({ cronId: job.id, name: job.name, status: execution.status });
      }
      return { executed: results.length, results };
    })
    .get("/:id", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const job = await store.get(params.id, scopeId);
      if (!job) return status(404, { error: `Cron job not found: ${params.id}` });
      return job;
    })
    .patch("/:id", async ({ params, body, headers }) => {
      const b = body as any;
      const scopeId = headers["x-scope-id"] || undefined;
      const job = await store.update(params.id, b, scopeId);
      if (ctx.cronScheduler) {
        if (ctx.cronScheduler.update) {
          await ctx.cronScheduler.update(job, `/crons/${job.id}/run`);
        } else {
          await ctx.cronScheduler.unschedule(params.id);
          if (job.enabled) await ctx.cronScheduler.schedule(job, `/crons/${job.id}/run`);
        }
      }
      return job;
    })
    .delete("/:id", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      if (ctx.cronScheduler) await ctx.cronScheduler.unschedule(params.id);
      const deleted = await store.delete(params.id, scopeId);
      if (!deleted) return status(404, { error: `Cron job not found: ${params.id}` });
      return { deleted: true };
    })
    .post("/:id/run", async ({ params, headers, status }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const job = await store.get(params.id, scopeId);
      if (!job) return status(404, { error: `Cron job not found: ${params.id}` });
      const execution = await executeCronJob(ctx, job, scopeId);
      return execution;
    })
    .get("/:id/history", async ({ params, query, headers }) => {
      const scopeId = headers["x-scope-id"] || undefined;
      const limit = query.limit ? parseInt(query.limit as string, 10) : undefined;
      const executions = await store.listExecutions(params.id, limit, scopeId);
      return { executions, count: executions.length };
    });
}
