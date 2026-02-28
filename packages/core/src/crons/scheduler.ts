import type { CronJob } from "../storage/interfaces.js";

/**
 * Pluggable trigger layer for cron jobs.
 *
 * Implementations register triggers with external services (or an internal tick loop)
 * that fire at the scheduled time and POST to the callback URL to execute the job.
 */
export interface CronScheduler {
  /** Register a cron job trigger. For external schedulers, creates a callback to `callbackUrl`. */
  schedule(job: CronJob, callbackUrl: string): Promise<void>;
  /** Remove a cron job trigger. */
  unschedule(jobId: string): Promise<void>;
  /** Update an existing trigger (default: unschedule + schedule). */
  update?(job: CronJob, callbackUrl: string): Promise<void>;
}
