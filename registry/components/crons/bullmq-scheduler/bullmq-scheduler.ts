import type { CronScheduler, CronJob } from "@kitn/core";

/**
 * BullMQ CronScheduler — Redis-backed job scheduling.
 *
 * Uses BullMQ's repeatable jobs feature for recurring crons and delayed jobs for one-offs.
 * Jobs are processed by a BullMQ Worker that POSTs to the callback URL.
 *
 * @param options.connection - Redis connection options
 * @param options.queueName - Queue name (default: "kitn-crons")
 * @param options.baseUrl - Base URL for HTTP callbacks (optional, for external execution)
 */
export function createBullMQScheduler(options: {
  connection: {
    host?: string;
    port?: number;
    password?: string;
  };
  queueName?: string;
  baseUrl?: string;
}): CronScheduler & { close(): Promise<void> } {
  // Lazy import to avoid bundling bullmq when not used
  let Queue: any;
  let Worker: any;

  const queueName = options.queueName ?? "kitn-crons";
  const connection = {
    host: options.connection.host ?? process.env.REDIS_HOST ?? "localhost",
    port: options.connection.port ?? parseInt(process.env.REDIS_PORT ?? "6379", 10),
    password: options.connection.password ?? process.env.REDIS_PASSWORD,
  };

  let queue: any;
  let worker: any;

  async function ensureQueue() {
    if (!queue) {
      const bullmq = await import("bullmq");
      Queue = bullmq.Queue;
      Worker = bullmq.Worker;

      queue = new Queue(queueName, { connection });

      // Create worker that POSTs to the callback URL
      worker = new Worker(
        queueName,
        async (job: any) => {
          const { callbackUrl } = job.data;
          const url = options.baseUrl
            ? `${options.baseUrl}${callbackUrl}`
            : callbackUrl;

          const res = await fetch(url, { method: "POST" });
          if (!res.ok) {
            throw new Error(`Cron execution failed: ${res.status}`);
          }
        },
        { connection, concurrency: 5 },
      );
    }
    return queue;
  }

  return {
    async schedule(job: CronJob, callbackUrl: string) {
      const q = await ensureQueue();

      if (job.schedule) {
        // Recurring — use BullMQ repeatable job
        await q.add(
          `cron:${job.id}`,
          { cronId: job.id, callbackUrl },
          {
            repeat: { pattern: job.schedule },
            jobId: `cron:${job.id}`,
          },
        );
      } else if (job.runAt) {
        // One-off — use delayed job
        const delay = Math.max(0, new Date(job.runAt).getTime() - Date.now());
        await q.add(
          `cron:${job.id}`,
          { cronId: job.id, callbackUrl },
          {
            delay,
            jobId: `cron:${job.id}`,
          },
        );
      }
    },

    async unschedule(jobId: string) {
      const q = await ensureQueue();

      // Remove repeatable job
      try {
        const repeatableJobs = await q.getRepeatableJobs();
        const matching = repeatableJobs.find((j: any) => j.name === `cron:${jobId}`);
        if (matching) {
          await q.removeRepeatableByKey(matching.key);
        }
      } catch {
        // Ignore — job may not exist
      }

      // Also try to remove a delayed one-off job
      try {
        const job = await q.getJob(`cron:${jobId}`);
        if (job) await job.remove();
      } catch {
        // Ignore
      }
    },

    async update(job: CronJob, callbackUrl: string) {
      await this.unschedule(job.id);
      await this.schedule(job, callbackUrl);
    },

    async close() {
      if (worker) await worker.close();
      if (queue) await queue.close();
    },
  };
}
