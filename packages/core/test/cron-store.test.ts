import { describe, test, expect, afterAll } from "bun:test";
import { createMemoryStorage } from "../src/storage/in-memory/index.js";
import { createFileStorage } from "../src/storage/file-storage/index.js";
import type { CronStore, CronJob } from "../src/storage/interfaces.js";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const FILE_STORAGE_DIR = join(tmpdir(), `kitn-cron-test-${Date.now()}`);

function makeCronJob(overrides?: Partial<Omit<CronJob, "id" | "createdAt" | "updatedAt">>): Omit<CronJob, "id" | "createdAt" | "updatedAt"> {
  return {
    name: "daily-report",
    description: "Run daily report",
    schedule: "0 6 * * *",
    agentName: "reporter",
    input: "Generate the daily report",
    enabled: true,
    nextRun: new Date(Date.now() + 3_600_000).toISOString(),
    ...overrides,
  };
}

function suiteFor(label: string, factory: () => CronStore) {
  describe(label, () => {
    let store: CronStore;

    test("setup", () => {
      store = factory();
    });

    // ── CRUD tests ──

    test("create and get a cron job", async () => {
      const job = await store.create(makeCronJob());
      expect(job.id).toBeDefined();
      expect(job.name).toBe("daily-report");
      expect(job.createdAt).toBeDefined();
      expect(job.updatedAt).toBeDefined();

      const fetched = await store.get(job.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("daily-report");
    });

    test("list cron jobs", async () => {
      // Already has one from previous test
      const jobs = await store.list();
      expect(jobs.length).toBeGreaterThanOrEqual(1);
    });

    test("get nonexistent returns null", async () => {
      const result = await store.get("nonexistent-id");
      expect(result).toBeNull();
    });

    test("update a cron job", async () => {
      const job = await store.create(makeCronJob());
      await new Promise((r) => setTimeout(r, 5)); // ensure updatedAt differs
      const updated = await store.update(job.id, { enabled: false, input: "Updated input" });
      expect(updated.enabled).toBe(false);
      expect(updated.input).toBe("Updated input");
      expect(updated.updatedAt).not.toBe(job.updatedAt);
    });

    test("delete a cron job", async () => {
      const job = await store.create(makeCronJob());
      const deleted = await store.delete(job.id);
      expect(deleted).toBe(true);

      const result = await store.get(job.id);
      expect(result).toBeNull();
    });

    test("delete nonexistent returns false", async () => {
      const deleted = await store.delete("nonexistent");
      expect(deleted).toBe(false);
    });

    // ── One-off job tests ──

    test("create a one-off job with runAt", async () => {
      const job = await store.create(makeCronJob({
        name: "one-off",
        schedule: undefined,
        runAt: "2026-03-07T17:00:00Z",
      }));
      expect(job.runAt).toBe("2026-03-07T17:00:00Z");
      expect(job.schedule).toBeUndefined();
    });

    // ── Execution history tests ──

    test("add and list execution history", async () => {
      const job = await store.create(makeCronJob());

      const exec1 = await store.addExecution({
        cronId: job.id,
        startedAt: "2026-02-28T06:00:00Z",
        completedAt: "2026-02-28T06:00:05Z",
        status: "completed",
        summary: "Done",
      });
      expect(exec1.id).toBeDefined();
      expect(exec1.cronId).toBe(job.id);

      const exec2 = await store.addExecution({
        cronId: job.id,
        startedAt: "2026-03-01T06:00:00Z",
        status: "running",
      });

      const history = await store.listExecutions(job.id);
      expect(history).toHaveLength(2);
    });

    test("listExecutions respects limit", async () => {
      const job = await store.create(makeCronJob());
      for (let i = 0; i < 5; i++) {
        await store.addExecution({
          cronId: job.id,
          startedAt: new Date(2026, 0, i + 1).toISOString(),
          status: "completed",
        });
      }

      const history = await store.listExecutions(job.id, 3);
      expect(history).toHaveLength(3);
    });

    test("updateExecution marks job completed", async () => {
      const job = await store.create(makeCronJob());
      const exec = await store.addExecution({
        cronId: job.id,
        startedAt: "2026-02-28T06:00:00Z",
        status: "running",
      });

      const updated = await store.updateExecution(exec.id, {
        status: "completed",
        completedAt: "2026-02-28T06:00:05Z",
        summary: "All done",
      });
      expect(updated.status).toBe("completed");
      expect(updated.completedAt).toBe("2026-02-28T06:00:05Z");
    });

    // ── getDueJobs tests ──

    test("getDueJobs returns enabled jobs with nextRun <= now", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 3_600_000).toISOString();

      await store.create(makeCronJob({ name: "due", nextRun: past }));
      await store.create(makeCronJob({ name: "not-due", nextRun: future }));
      await store.create(makeCronJob({ name: "disabled", nextRun: past, enabled: false }));

      const due = await store.getDueJobs(new Date());
      expect(due).toHaveLength(1);
      expect(due[0].name).toBe("due");
    });

    test("getDueJobs returns one-off jobs with runAt <= now and no lastRun", async () => {
      const past = new Date(Date.now() - 60_000).toISOString();

      await store.create(makeCronJob({
        name: "one-off-due",
        schedule: undefined,
        runAt: past,
      }));
      await store.create(makeCronJob({
        name: "one-off-already-ran",
        schedule: undefined,
        runAt: past,
        lastRun: past,
      }));

      const due = await store.getDueJobs(new Date());
      // "due" from the previous test is also still due, so filter by name
      const oneOffDue = due.filter((j) => j.name === "one-off-due");
      const oneOffAlreadyRan = due.filter((j) => j.name === "one-off-already-ran");
      expect(oneOffDue).toHaveLength(1);
      expect(oneOffAlreadyRan).toHaveLength(0);
    });

    // ── Scope tests ──

    test("scoped jobs are isolated", async () => {
      await store.create(makeCronJob({ name: "global" }));
      await store.create(makeCronJob({ name: "tenant-1-job" }), "tenant-1");
      await store.create(makeCronJob({ name: "tenant-2-job" }), "tenant-2");

      // Global list contains jobs from earlier tests too, but scoped lists are isolated
      const globalList = await store.list();
      expect(globalList.some((j) => j.name === "global")).toBe(true);
      // Scoped lists should not contain global or other-scope jobs
      expect(globalList.some((j) => j.name === "tenant-1-job")).toBe(false);
      expect(globalList.some((j) => j.name === "tenant-2-job")).toBe(false);

      const t1List = await store.list("tenant-1");
      expect(t1List).toHaveLength(1);
      expect(t1List[0].name).toBe("tenant-1-job");

      const t2List = await store.list("tenant-2");
      expect(t2List).toHaveLength(1);
      expect(t2List[0].name).toBe("tenant-2-job");
    });
  });
}

// ── In-memory suite ──

suiteFor("CronStore (in-memory)", () => {
  return createMemoryStorage().crons;
});

// ── File-based suite ──

let fileStorageInstance: ReturnType<typeof createFileStorage> | null = null;

suiteFor("CronStore (file-based)", () => {
  const subDir = join(FILE_STORAGE_DIR, `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fileStorageInstance = createFileStorage({ dataDir: subDir });
  return fileStorageInstance.crons;
});

afterAll(async () => {
  try {
    await rm(FILE_STORAGE_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});
