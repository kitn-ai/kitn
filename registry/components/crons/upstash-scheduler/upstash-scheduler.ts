import type { CronScheduler } from "@kitn/core";
import type { CronJob } from "@kitn/core";

/**
 * Upstash QStash CronScheduler — uses QStash to trigger cron jobs via HTTP callbacks.
 *
 * @param options.token - QStash API token (or reads from QSTASH_TOKEN env var)
 * @param options.baseUrl - Base URL of your API server (e.g. "https://my-app.vercel.app/api")
 */
export function createUpstashScheduler(options: {
  token?: string;
  baseUrl: string;
}): CronScheduler {
  const token = options.token ?? process.env.QSTASH_TOKEN;
  if (!token) throw new Error("QSTASH_TOKEN is required");

  // Store QStash schedule IDs keyed by cron job ID
  const scheduleIds = new Map<string, string>();

  const qstashBase = "https://qstash.upstash.io/v2";

  async function qstashFetch(path: string, init?: RequestInit) {
    const res = await fetch(`${qstashBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`QStash API error ${res.status}: ${body}`);
    }
    return res;
  }

  return {
    async schedule(job: CronJob, callbackUrl: string) {
      const url = `${options.baseUrl}${callbackUrl}`;

      if (job.schedule) {
        // Recurring job — create a QStash schedule
        const res = await qstashFetch("/schedules", {
          method: "POST",
          body: JSON.stringify({
            destination: url,
            cron: job.schedule,
          }),
        });
        const data = (await res.json()) as { scheduleId: string };
        scheduleIds.set(job.id, data.scheduleId);
      } else if (job.runAt) {
        // One-off job — publish with delay
        const delay = Math.max(0, new Date(job.runAt).getTime() - Date.now());
        const delaySec = Math.ceil(delay / 1000);
        await qstashFetch(`/publish/${url}`, {
          method: "POST",
          headers: {
            "Upstash-Delay": `${delaySec}s`,
          },
        });
      }
    },

    async unschedule(jobId: string) {
      const scheduleId = scheduleIds.get(jobId);
      if (scheduleId) {
        await qstashFetch(`/schedules/${scheduleId}`, { method: "DELETE" });
        scheduleIds.delete(jobId);
      }
    },

    async update(job: CronJob, callbackUrl: string) {
      await this.unschedule(job.id);
      await this.schedule(job, callbackUrl);
    },
  };
}
