import { describe, test, expect, mock } from "bun:test";
import { createLifecycleHooks } from "./lifecycle-hooks.js";
import { createEventBuffer } from "../jobs/event-buffer.js";
import { createMemoryStorage } from "../storage/in-memory/index.js";
import type { AgentEndEvent, ToolExecuteEvent } from "./lifecycle-hooks.js";
import type { BufferedEvent } from "../jobs/event-buffer.js";

describe("Integration: lifecycle hooks + event buffer + JobStore", () => {
  test("hooks + event buffer work together", () => {
    const hooks = createLifecycleHooks({ level: "summary" });
    const buffer = createEventBuffer();

    const handlerCalled: AgentEndEvent[] = [];
    const jobId = "job_1";

    // Subscribe to agent:end — push events into both a local array and the buffer
    hooks.on("agent:end", (data) => {
      handlerCalled.push(data);
      buffer.push(jobId, {
        id: `evt_${Date.now()}`,
        event: "agent:end",
        data: JSON.stringify(data),
      });
    });

    const event: AgentEndEvent = {
      agentName: "test-agent",
      input: "hello",
      output: "world",
      toolsUsed: ["search"],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      duration: 200,
      conversationId: "conv-1",
      timestamp: Date.now(),
    };

    hooks.emit("agent:end", event);

    // Handler was called
    expect(handlerCalled).toHaveLength(1);
    expect(handlerCalled[0].agentName).toBe("test-agent");
    expect(handlerCalled[0].output).toBe("world");

    // Buffer has the event
    const replayed = buffer.replay(jobId);
    expect(replayed).toHaveLength(1);
    expect(replayed[0].event).toBe("agent:end");

    const parsed = JSON.parse(replayed[0].data);
    expect(parsed.agentName).toBe("test-agent");
    expect(parsed.output).toBe("world");
  });

  test("memory storage JobStore works end-to-end", async () => {
    const storage = createMemoryStorage();
    const jobStore = storage.jobs;

    // Create a job
    const job = await jobStore.create({
      agentName: "summarizer",
      input: "Summarize this document",
      conversationId: "conv-42",
      status: "queued",
    });

    expect(job.id).toBeDefined();
    expect(job.status).toBe("queued");
    expect(job.agentName).toBe("summarizer");
    expect(job.createdAt).toBeDefined();

    // Update to completed
    const updated = await jobStore.update(job.id, {
      status: "completed",
      result: "Document is about AI agents.",
      completedAt: new Date().toISOString(),
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      toolsUsed: ["read-file", "search"],
    });

    expect(updated.status).toBe("completed");
    expect(updated.result).toBe("Document is about AI agents.");
    expect(updated.toolsUsed).toEqual(["read-file", "search"]);
    expect(updated.usage?.totalTokens).toBe(300);

    // List returns the updated job
    const jobs = await jobStore.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(job.id);
    expect(jobs[0].status).toBe("completed");
    expect(jobs[0].result).toBe("Document is about AI agents.");

    // Get by ID also returns updated state
    const fetched = await jobStore.get(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.status).toBe("completed");
  });

  test("hooks level filtering works end-to-end", () => {
    const hooks = createLifecycleHooks({ level: "summary" });

    const agentEndCalls: AgentEndEvent[] = [];
    const toolExecuteCalls: ToolExecuteEvent[] = [];

    // Subscribe to agent:end (summary-level event)
    hooks.on("agent:end", (data) => {
      agentEndCalls.push(data);
    });

    // Subscribe to tool:execute (trace-level event)
    hooks.on("tool:execute", (data) => {
      toolExecuteCalls.push(data);
    });

    // Emit both events
    hooks.emit("agent:end", {
      agentName: "assistant",
      input: "hi",
      output: "hello",
      toolsUsed: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      duration: 50,
      conversationId: "conv-1",
      timestamp: Date.now(),
    });

    hooks.emit("tool:execute", {
      agentName: "assistant",
      toolName: "web-search",
      input: { query: "test" },
      output: { results: [] },
      duration: 30,
      conversationId: "conv-1",
      timestamp: Date.now(),
    });

    // Only agent:end handler was called (summary level allows it)
    expect(agentEndCalls).toHaveLength(1);
    expect(agentEndCalls[0].agentName).toBe("assistant");

    // tool:execute handler was NOT called (filtered at summary level)
    expect(toolExecuteCalls).toHaveLength(0);
  });

  test("event buffer replay + listener pattern", () => {
    const buffer = createEventBuffer();
    const jobId = "job_replay";

    // Push initial events before any listener is attached
    buffer.push(jobId, { id: "evt_1", event: "agent:start", data: '{"input":"hello"}' });
    buffer.push(jobId, { id: "evt_2", event: "tool:execute", data: '{"tool":"search"}' });

    // Add a listener — should only get NEW events from this point on
    const liveEvents: BufferedEvent[] = [];
    const unsub = buffer.addListener(jobId, (event) => {
      liveEvents.push(event);
    });

    // Push more events after listener is attached
    buffer.push(jobId, { id: "evt_3", event: "agent:end", data: '{"output":"done"}' });
    buffer.push(jobId, { id: "evt_4", event: "job:end", data: '{"duration":500}' });

    // Listener only received events pushed AFTER subscription
    expect(liveEvents).toHaveLength(2);
    expect(liveEvents[0].id).toBe("evt_3");
    expect(liveEvents[1].id).toBe("evt_4");

    // Replay returns ALL events (both before and after listener was attached)
    const allEvents = buffer.replay(jobId);
    expect(allEvents).toHaveLength(4);
    expect(allEvents[0].id).toBe("evt_1");
    expect(allEvents[1].id).toBe("evt_2");
    expect(allEvents[2].id).toBe("evt_3");
    expect(allEvents[3].id).toBe("evt_4");

    // Unsubscribe and verify no more events are received
    unsub();
    buffer.push(jobId, { id: "evt_5", event: "cleanup", data: '{}' });
    expect(liveEvents).toHaveLength(2); // Still 2, unsubscribed

    // But replay still has all 5
    expect(buffer.replay(jobId)).toHaveLength(5);
  });
});
