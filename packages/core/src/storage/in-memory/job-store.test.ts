import { describe, test, expect } from "bun:test";
import { createJobStore } from "./job-store.js";
import type { JobStore, Job } from "../interfaces.js";

function makeJobInput(overrides?: Partial<Omit<Job, "id" | "createdAt">>): Omit<Job, "id" | "createdAt"> {
  return {
    agentName: "summarizer",
    input: "Summarize the latest news",
    conversationId: "conv_1",
    status: "queued" as const,
    ...overrides,
  };
}

describe("JobStore (in-memory)", () => {
  let store: JobStore;

  test("setup", () => {
    store = createJobStore();
  });

  test("creates a job with generated id and timestamp", async () => {
    const job = await store.create(makeJobInput());
    expect(job.id).toMatch(/^job_/);
    expect(job.agentName).toBe("summarizer");
    expect(job.input).toBe("Summarize the latest news");
    expect(job.conversationId).toBe("conv_1");
    expect(job.status).toBe("queued");
    expect(job.createdAt).toBeDefined();
  });

  test("gets a job by id", async () => {
    const job = await store.create(makeJobInput());
    const fetched = await store.get(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(job.id);
    expect(fetched!.agentName).toBe("summarizer");
  });

  test("returns null for non-existent job", async () => {
    const result = await store.get("nonexistent-id");
    expect(result).toBeNull();
  });

  test("lists all jobs", async () => {
    const jobs = await store.list();
    expect(jobs.length).toBeGreaterThanOrEqual(2);
  });

  test("updates a job", async () => {
    const job = await store.create(makeJobInput());
    const updated = await store.update(job.id, {
      status: "completed",
      result: "Summary complete",
      completedAt: new Date().toISOString(),
    });
    expect(updated.status).toBe("completed");
    expect(updated.result).toBe("Summary complete");
    expect(updated.completedAt).toBeDefined();
  });

  test("deletes a job", async () => {
    const job = await store.create(makeJobInput());
    const deleted = await store.delete(job.id);
    expect(deleted).toBe(true);

    const result = await store.get(job.id);
    expect(result).toBeNull();
  });

  test("scopes jobs by scopeId", async () => {
    const store2 = createJobStore();

    await store2.create(makeJobInput({ agentName: "global-agent" }));
    await store2.create(makeJobInput({ agentName: "tenant-1-agent", scopeId: "tenant-1" }));
    await store2.create(makeJobInput({ agentName: "tenant-2-agent", scopeId: "tenant-2" }));

    const globalList = await store2.list();
    expect(globalList.some((j) => j.agentName === "global-agent")).toBe(true);
    expect(globalList.some((j) => j.agentName === "tenant-1-agent")).toBe(false);
    expect(globalList.some((j) => j.agentName === "tenant-2-agent")).toBe(false);

    const t1List = await store2.list("tenant-1");
    expect(t1List).toHaveLength(1);
    expect(t1List[0].agentName).toBe("tenant-1-agent");

    const t2List = await store2.list("tenant-2");
    expect(t2List).toHaveLength(1);
    expect(t2List[0].agentName).toBe("tenant-2-agent");
  });
});
