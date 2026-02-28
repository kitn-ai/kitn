import type { PluginContext } from "../types.js";
import type { CronJob, CronExecution } from "../storage/interfaces.js";
import { runAgent } from "../agents/run-agent.js";
import { getNextRun } from "./cron-parser.js";

/**
 * Execute a single cron job. Used by:
 * - InternalScheduler tick loop
 * - POST /crons/:id/run endpoint (called by external schedulers)
 */
export async function executeCronJob(
  ctx: PluginContext,
  job: CronJob,
  scopeId?: string,
): Promise<CronExecution> {
  const startedAt = new Date().toISOString();

  // Create execution record
  let execution = await ctx.storage.crons.addExecution({
    cronId: job.id,
    startedAt,
    status: "running",
  }, scopeId);

  try {
    // Look up the agent
    const agent = ctx.agents.get(job.agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${job.agentName}`);
    }

    // Run the agent
    const result = await runAgent(
      ctx,
      {
        system: agent.defaultSystem,
        tools: agent.tools ?? {},
        agentName: agent.name,
      },
      job.input,
      job.model,
    );

    // Extract summary (truncate response)
    const summary = typeof result.response === "string"
      ? result.response.slice(0, 500)
      : JSON.stringify(result.response).slice(0, 500);

    // Mark completed
    execution = await ctx.storage.crons.updateExecution(execution.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      summary,
    }, scopeId);
  } catch (err: any) {
    // Mark failed
    execution = await ctx.storage.crons.updateExecution(execution.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: err.message ?? String(err),
    }, scopeId);
  }

  // Update job state
  const now = new Date();
  const updates: Partial<CronJob> = { lastRun: now.toISOString() };

  if (job.schedule) {
    // Recurring: compute next run
    try {
      updates.nextRun = getNextRun(job.schedule, now, job.timezone).toISOString();
    } catch {
      // If we can't compute next run, disable the job
      updates.enabled = false;
    }
  } else if (job.runAt) {
    // One-off: disable after execution
    updates.enabled = false;
  }

  await ctx.storage.crons.update(job.id, updates, scopeId);

  return execution;
}
