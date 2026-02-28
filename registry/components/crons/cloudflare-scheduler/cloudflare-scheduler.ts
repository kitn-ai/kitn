import type { CronScheduler } from "@kitn/core";

/**
 * Cloudflare Cron Triggers CronScheduler.
 *
 * Cloudflare cron triggers are configured in wrangler.toml (static config), not dynamically.
 * This scheduler is a no-op — the actual triggering is done by Cloudflare's cron trigger
 * calling the Worker's `scheduled` event, which should POST to /crons/tick.
 *
 * ## Setup
 *
 * 1. Add a cron trigger to your wrangler.toml:
 *    ```toml
 *    [triggers]
 *    crons = ["* * * * *"]  # every minute (adjust as needed)
 *    ```
 *
 * 2. Handle the scheduled event in your Worker:
 *    ```typescript
 *    export default {
 *      async scheduled(event, env, ctx) {
 *        ctx.waitUntil(
 *          fetch(`${env.API_URL}/crons/tick`, { method: "POST" })
 *        );
 *      },
 *      async fetch(request, env) {
 *        // your normal request handler
 *      },
 *    };
 *    ```
 */
export function createCloudflareScheduler(): CronScheduler {
  return {
    async schedule() {
      // No-op: Cloudflare cron triggers are configured in wrangler.toml
    },
    async unschedule() {
      // No-op: Cloudflare cron triggers are configured in wrangler.toml
    },
  };
}

/**
 * Example Cloudflare Worker scheduled event handler.
 * Calls the /crons/tick endpoint to process all due cron jobs.
 */
export async function handleScheduledEvent(
  apiUrl: string,
  ctx: { waitUntil(promise: Promise<any>): void },
) {
  ctx.waitUntil(
    fetch(`${apiUrl}/crons/tick`, { method: "POST" }),
  );
}
