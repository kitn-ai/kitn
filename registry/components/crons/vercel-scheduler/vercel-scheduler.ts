import type { CronScheduler } from "@kitn/core";

/**
 * Vercel Cron CronScheduler.
 *
 * Vercel Cron Jobs are configured in vercel.json (static config), not dynamically.
 * This scheduler is a no-op — the actual triggering is done by Vercel's cron service.
 *
 * ## Setup
 *
 * 1. Set the CRON_SECRET environment variable in your Vercel project settings.
 *
 * 2. Add a cron job to your vercel.json:
 *    ```json
 *    {
 *      "crons": [
 *        {
 *          "path": "/api/crons/tick",
 *          "schedule": "* * * * *"
 *        }
 *      ]
 *    }
 *    ```
 *
 * 3. Use `verifyCronSecret()` middleware to verify the request:
 *    ```typescript
 *    app.use("/crons/tick", verifyCronSecret());
 *    ```
 */
export function createVercelScheduler(): CronScheduler {
  return {
    async schedule() {
      // No-op: Vercel cron jobs are configured in vercel.json
    },
    async unschedule() {
      // No-op: Vercel cron jobs are configured in vercel.json
    },
  };
}

/**
 * Middleware factory that verifies the CRON_SECRET header.
 * Vercel sends an Authorization header with "Bearer <CRON_SECRET>" on cron requests.
 *
 * @param secret - The secret to verify against (defaults to CRON_SECRET env var)
 */
export function verifyCronSecret(secret?: string) {
  const cronSecret = secret ?? process.env.CRON_SECRET;

  return async (c: any, next: () => Promise<void>) => {
    if (!cronSecret) {
      console.warn("[cron] CRON_SECRET not set — skipping verification");
      return next();
    }

    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return next();
  };
}

/**
 * Helper to generate the vercel.json crons entry.
 */
export function generateVercelCronConfig(
  path = "/api/crons/tick",
  schedule = "* * * * *",
) {
  return {
    crons: [{ path, schedule }],
  };
}
