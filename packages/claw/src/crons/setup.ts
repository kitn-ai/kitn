import { createInternalScheduler } from "@kitnai/core";
import type { PluginContext } from "@kitnai/core";

/**
 * Create a cron scheduler that ticks on a 60-second interval.
 *
 * The scheduler uses `ctx.storage.crons` to find due jobs and
 * `executeCronJob` from `@kitnai/core` to run them.
 */
export function setupCronScheduler(ctx: PluginContext) {
  const scheduler = createInternalScheduler(ctx, {
    onComplete: (job, execution) => {
      console.log(
        `[kitnclaw] Cron job "${job.name}" completed: ${execution.summary ?? "ok"}`,
      );
    },
    onError: (job, error) => {
      console.error(
        `[kitnclaw] Cron job "${job.name}" failed:`,
        error.message,
      );
    },
  });
  return scheduler;
}
