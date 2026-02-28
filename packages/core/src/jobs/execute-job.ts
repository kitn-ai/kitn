/**
 * Background job execution — runs an agent detached from the HTTP request lifecycle.
 *
 * Updates the JobStore as execution progresses and buffers SSE events for
 * reconnectable streaming.
 */

import type { PluginContext } from "../types.js";
import type { Job } from "../storage/interfaces.js";
import type { EventBuffer, BufferedEvent } from "./event-buffer.js";
import { runAgent } from "../agents/run-agent.js";

export interface JobExecutionContext {
  ctx: PluginContext;
  job: Job;
  eventBuffer: EventBuffer;
  abortController: AbortController;
}

/** Push a typed SSE event into the buffer for a job. */
function bufferEvent(
  eventBuffer: EventBuffer,
  jobId: string,
  event: string,
  data: Record<string, unknown>,
): void {
  const buffered: BufferedEvent = {
    id: `${jobId}-${Date.now()}`,
    event,
    data: JSON.stringify(data),
  };
  eventBuffer.push(jobId, buffered);
}

/**
 * Execute a job in the background.
 *
 * 1. Marks job as "running"
 * 2. Looks up agent and resolves system prompt + tools
 * 3. Calls runAgent
 * 4. On success: marks "completed" with result, usage, toolsUsed
 * 5. On abort: marks "cancelled"
 * 6. On error: marks "failed" with error message
 *
 * Emits lifecycle hooks at each stage and buffers SSE events for streaming.
 */
export async function executeJobInBackground(execCtx: JobExecutionContext): Promise<void> {
  const { ctx, job, eventBuffer, abortController } = execCtx;
  const startTime = performance.now();

  // 1. Update job status to "running"
  await ctx.storage.jobs.update(job.id, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  // 2. Emit "job:start" lifecycle hook
  ctx.hooks?.emit("job:start", {
    jobId: job.id,
    agentName: job.agentName,
    input: job.input,
    conversationId: job.conversationId,
    scopeId: job.scopeId,
    timestamp: Date.now(),
  });

  try {
    // 3. Look up the agent
    const agent = ctx.agents.get(job.agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${job.agentName}`);
    }

    // 4. Get resolved system prompt (respects prompt overrides)
    const system = await ctx.agents.getResolvedPrompt(job.agentName) ?? agent.defaultSystem;

    // 5. Resolve tools from agent registration
    const tools = agent.tools ?? {};

    // 6. Run the agent
    const result = await runAgent(
      ctx,
      { system, tools, agentName: agent.name },
      job.input,
    );

    // Check if aborted during execution
    if (abortController.signal.aborted) {
      const duration = performance.now() - startTime;
      await ctx.storage.jobs.update(job.id, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });

      ctx.hooks?.emit("job:cancelled", {
        jobId: job.id,
        agentName: job.agentName,
        duration,
        timestamp: Date.now(),
      });

      bufferEvent(eventBuffer, job.id, "cancelled", {
        jobId: job.id,
        status: "cancelled",
      });
      return;
    }

    // 7. Success — update job to "completed"
    const duration = performance.now() - startTime;
    const usage = {
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    };

    await ctx.storage.jobs.update(job.id, {
      status: "completed",
      result: result.response,
      usage,
      toolsUsed: result.toolsUsed,
      completedAt: new Date().toISOString(),
    });

    ctx.hooks?.emit("job:end", {
      jobId: job.id,
      agentName: job.agentName,
      output: result.response ?? "",
      duration,
      usage,
      timestamp: Date.now(),
    });

    bufferEvent(eventBuffer, job.id, "done", {
      jobId: job.id,
      status: "completed",
      result: result.response,
    });
  } catch (err: unknown) {
    // Check for abort
    if (abortController.signal.aborted) {
      const duration = performance.now() - startTime;
      await ctx.storage.jobs.update(job.id, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });

      ctx.hooks?.emit("job:cancelled", {
        jobId: job.id,
        agentName: job.agentName,
        duration,
        timestamp: Date.now(),
      });

      bufferEvent(eventBuffer, job.id, "cancelled", {
        jobId: job.id,
        status: "cancelled",
      });
      return;
    }

    // 9. Error — update job to "failed"
    const duration = performance.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    await ctx.storage.jobs.update(job.id, {
      status: "failed",
      error: errorMessage,
      completedAt: new Date().toISOString(),
    });

    ctx.hooks?.emit("agent:error", {
      agentName: job.agentName,
      input: job.input,
      error: errorMessage,
      duration,
      conversationId: job.conversationId,
      scopeId: job.scopeId,
      jobId: job.id,
      timestamp: Date.now(),
    });

    bufferEvent(eventBuffer, job.id, "error", {
      jobId: job.id,
      status: "failed",
      error: errorMessage,
    });
  }
}
