import type { PluginContext } from "../types.js";
import type { CronJob, CronExecution } from "../storage/interfaces.js";
import type { CronScheduler } from "./scheduler.js";
import { executeCronJob } from "./execute-cron.js";

export interface InternalSchedulerOptions {
  /** Tick interval in milliseconds. Default: 60_000 (1 minute). */
  interval?: number;
  /** Called after a job completes successfully. */
  onComplete?: (job: CronJob, execution: CronExecution) => void;
  /** Called when a job fails. */
  onError?: (job: CronJob, error: Error) => void;
}

export function createInternalScheduler(
  ctx: PluginContext,
  options?: InternalSchedulerOptions,
): CronScheduler & { start(): void; stop(): void; tick(): Promise<void> } {
  const interval = options?.interval ?? 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick() {
    try {
      const dueJobs = await ctx.storage.crons.getDueJobs(new Date());
      for (const job of dueJobs) {
        try {
          const execution = await executeCronJob(ctx, job);
          if (execution.status === "completed") {
            options?.onComplete?.(job, execution);
          } else if (execution.status === "failed") {
            options?.onError?.(job, new Error(execution.error ?? "Unknown error"));
          }
        } catch (err: any) {
          options?.onError?.(job, err);
        }
      }
    } catch (err) {
      console.error("[cron] Tick error:", err);
    }
  }

  return {
    // CronScheduler interface — no-ops for internal scheduler
    async schedule() {},
    async unschedule() {},

    start() {
      if (timer) return;
      timer = setInterval(tick, interval);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    tick,
  };
}
