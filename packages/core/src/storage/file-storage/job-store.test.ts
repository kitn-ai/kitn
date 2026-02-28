import { describe, test, expect, afterAll } from "bun:test";
import { createFileJobStore } from "./job-store.js";
import type { JobStore, Job } from "../interfaces.js";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const FILE_STORAGE_DIR = join(tmpdir(), `kitn-job-test-${Date.now()}`);

function makeJobInput(overrides?: Partial<Omit<Job, "id" | "createdAt">>): Omit<Job, "id" | "createdAt"> {
  return {
    agentName: "summarizer",
    input: "Summarize the latest news",
    conversationId: "conv_1",
    status: "queued" as const,
    ...overrides,
  };
}

describe("JobStore (file-based)", () => {
  let store: JobStore;

  test("setup", () => {
    store = createFileJobStore(FILE_STORAGE_DIR);
  });

  test("creates a job with generated id", async () => {
    const job = await store.create(makeJobInput());
    expect(job.id).toMatch(/^job_/);
    expect(job.agentName).toBe("summarizer");
    expect(job.status).toBe("queued");
    expect(job.createdAt).toBeDefined();
  });

  test("persists and retrieves a job", async () => {
    const job = await store.create(makeJobInput());
    const fetched = await store.get(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(job.id);
    expect(fetched!.agentName).toBe("summarizer");
    expect(fetched!.input).toBe("Summarize the latest news");
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
});

afterAll(async () => {
  try {
    await rm(FILE_STORAGE_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});
