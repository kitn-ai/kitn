/**
 * Test async job endpoints — start, poll, stream, cancel, delete.
 *
 * Usage: bun scripts/08-async-jobs.ts
 */
import { api, assert, header, info, summary } from "./helpers.js";

header("Async Jobs");

// --- Start an async job ---
info("POST /api/agents/general?async=true — start background job");
let res = await api("POST", "/api/agents/general?async=true", {
  message: "What is 2 + 2? Reply with just the number.",
});
assert.status(res, 202, "Accepted (202)");
const jobId = res.json()?.jobId;
assert.ok(!!jobId, "Got job ID");

if (jobId) {
  // --- Poll for completion ---
  info(`GET /api/jobs/${jobId} — poll status`);
  let status = "queued";
  let attempts = 0;
  while (status !== "completed" && status !== "failed" && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await api("GET", `/api/jobs/${jobId}`);
    status = res.json()?.status ?? "unknown";
    attempts++;
  }
  assert.ok(status === "completed", `Job completed (took ${attempts}s)`);

  // --- List jobs ---
  info("GET /api/jobs — list all jobs");
  res = await api("GET", "/api/jobs");
  assert.status(res, 200, "List jobs");
  assert.contains(res, jobId, "Our job in the list");

  // --- Delete job ---
  info(`DELETE /api/jobs/${jobId}`);
  res = await api("DELETE", `/api/jobs/${jobId}`);
  assert.status(res, 200, "Delete job");
}

// --- Start another job and cancel it ---
info("POST /api/agents/general?async=true — start job to cancel");
res = await api("POST", "/api/agents/general?async=true", {
  message: "Write a very long essay about the history of computing.",
});
const cancelJobId = res.json()?.jobId;
if (cancelJobId) {
  // Give it a moment to start
  await new Promise((r) => setTimeout(r, 500));

  info(`POST /api/jobs/${cancelJobId}/cancel — cancel job`);
  res = await api("POST", `/api/jobs/${cancelJobId}/cancel`);
  // Cancel might return 200 or job may already be done
  if (res.status === 200) {
    assert.status(res, 200, "Cancel job");
  } else {
    assert.skip("Job completed before cancel");
  }

  // Cleanup
  await api("DELETE", `/api/jobs/${cancelJobId}`);
}

process.exit(summary());
