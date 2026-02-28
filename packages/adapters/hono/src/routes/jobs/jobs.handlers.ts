import type { Context } from "hono";
import type { PluginContext, EventBuffer } from "@kitnai/core";
import { createSSEStream } from "@kitnai/core";

export function createJobHandlers(ctx: PluginContext, eventBuffer: EventBuffer) {
  const store = ctx.storage.jobs;

  return {
    /** GET /jobs — list all jobs */
    async handleList(c: Context) {
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const jobs = await store.list(scopeId);
      return c.json({ jobs, count: jobs.length });
    },

    /** GET /jobs/:id — get job by id */
    async handleGet(c: Context) {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: `Job not found: ${id}` }, 404);
      return c.json(job);
    },

    /** GET /jobs/:id/stream — reconnectable SSE for running jobs */
    async handleStream(c: Context) {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: `Job not found: ${id}` }, 404);

      const isTerminal = job.status === "completed" || job.status === "failed" || job.status === "cancelled";

      if (isTerminal) {
        // Job is done — replay buffered events if any, otherwise return JSON
        const buffered = eventBuffer.replay(id);
        if (buffered.length > 0) {
          return createSSEStream(async (writer) => {
            for (const event of buffered) {
              await writer.writeSSE({ event: event.event, data: event.data, id: event.id });
            }
          });
        }
        // No buffered events — return the job as JSON fallback
        return c.json(job);
      }

      // Job is still running/queued — stream live events with replay
      return createSSEStream(async (writer) => {
        // 1. Replay any buffered events (for reconnection)
        const buffered = eventBuffer.replay(id);
        for (const event of buffered) {
          await writer.writeSSE({ event: event.event, data: event.data, id: event.id });
        }

        // 2. Listen for new live events
        await new Promise<void>((resolve) => {
          const unsubscribe = eventBuffer.addListener(id, async (event) => {
            await writer.writeSSE({ event: event.event, data: event.data, id: event.id });

            // Close stream on terminal events
            if (event.event === "done" || event.event === "error" || event.event === "cancelled") {
              unsubscribe();
              resolve();
            }
          });

          // Handle client disconnect
          c.req.raw.signal.addEventListener("abort", () => {
            unsubscribe();
            resolve();
          }, { once: true });
        });
      }, c.req.raw.signal);
    },

    /** POST /jobs/:id/cancel — cancel a running job */
    async handleCancel(c: Context) {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const job = await store.get(id, scopeId);
      if (!job) return c.json({ error: `Job not found: ${id}` }, 404);

      if (job.status !== "running" && job.status !== "queued") {
        return c.json({ error: `Job ${id} is not running or queued (status: ${job.status})` }, 409);
      }

      const updated = await store.update(id, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });

      return c.json(updated);
    },

    /** DELETE /jobs/:id — delete a job record */
    async handleDelete(c: Context) {
      const id = c.req.param("id");
      const scopeId = c.req.header("X-Scope-Id") || undefined;
      const deleted = await store.delete(id, scopeId);
      if (!deleted) return c.json({ error: `Job not found: ${id}` }, 404);

      // Clean up the event buffer for this job
      eventBuffer.cleanup(id);

      return c.json({ deleted: true });
    },
  };
}
