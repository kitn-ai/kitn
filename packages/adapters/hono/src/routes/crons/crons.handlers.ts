import type { Context } from "hono";
import type { PluginContext } from "@kitnai/core";
import { executeCronJob } from "@kitnai/core";

export function createCronHandlers(ctx: PluginContext) {
  const store = ctx.storage.crons;

  return {
    async handleList(c: Context) {
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const jobs = await store.list(scopeId);
      return c.json({ jobs, count: jobs.length });
    },

    async handleGet(c: Context) {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: `Cron job not found: ${id}` }, 404);
      return c.json(job);
    },

    async handleCreate(c: Context) {
      const body = await c.req.json();
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.create(body, scopeId);

      // Sync with scheduler if configured
      if (ctx.cronScheduler) {
        await ctx.cronScheduler.schedule(job, `/crons/${job.id}/run`);
      }

      return c.json(job, 201);
    },

    async handleUpdate(c: Context) {
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
    },

    async handleDelete(c: Context) {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;

      if (ctx.cronScheduler) {
        await ctx.cronScheduler.unschedule(id);
      }

      const deleted = await store.delete(id, scopeId);
      if (!deleted) return c.json({ error: `Cron job not found: ${id}` }, 404);
      return c.json({ deleted: true });
    },

    async handleRun(c: Context) {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: `Cron job not found: ${id}` }, 404);

      const execution = await executeCronJob(ctx, job, scopeId);
      return c.json(execution);
    },

    async handleHistory(c: Context) {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;
      const executions = await store.listExecutions(id, limit, scopeId);
      return c.json({ executions, count: executions.length });
    },

    async handleTick(c: Context) {
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const dueJobs = await store.getDueJobs(new Date(), scopeId);
      const results = [];
      for (const job of dueJobs) {
        const execution = await executeCronJob(ctx, job, scopeId);
        results.push({ cronId: job.id, name: job.name, status: execution.status });
      }
      return c.json({ executed: results.length, results });
    },
  };
}
