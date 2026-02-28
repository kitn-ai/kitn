# Background Jobs

Background jobs let you run agents asynchronously — fire-and-forget with a job ID, then poll for results or reconnect to a live SSE stream.

## When to Use

- Long-running agent tasks that would otherwise block HTTP requests
- Preventing wasted tokens when clients disconnect mid-execution
- Cron-like async execution without SSE streaming
- Any scenario where you need to track agent execution as a first-class resource

## Quick Start

Send any agent request with `?async=true`:

```typescript
// Fire and forget
const res = await fetch("/api/agents/email-checker?async=true", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Check my email and summarize" }),
});

const { jobId, conversationId } = await res.json();
// HTTP 202 Accepted — agent is running in the background
```

Then check the result:

```typescript
// Poll for status
const job = await fetch(`/api/jobs/${jobId}`).then(r => r.json());
// { status: "completed", result: "Found 3 emails...", usage: { ... } }
```

Or reconnect to a live stream:

```typescript
// Reconnectable SSE — replay missed events + stream live
const stream = new EventSource(`/api/jobs/${jobId}/stream`);
stream.addEventListener("text-delta", (e) => console.log(e.data));
stream.addEventListener("done", (e) => {
  console.log("Complete:", JSON.parse(e.data));
  stream.close();
});
```

## How It Works

```
Client                          Server
  |                               |
  | POST /agents/:name?async=true |
  |------------------------------>|
  |                               | 1. Create Job (status: "queued")
  |                               | 2. Spawn background execution
  |    { jobId, conversationId }  |
  |<------------------------------| HTTP 202
  |                               |
  |                               | 3. Agent runs (not tied to client)
  |                               | 4. SSE events buffered in memory
  |                               |
  | GET /jobs/:id                 |
  |------------------------------>|
  | { status: "running" }        |
  |<------------------------------|
  |                               |
  |                               | 5. Agent completes
  |                               | 6. Job updated (status: "completed")
  |                               |
  | GET /jobs/:id                 |
  |------------------------------>|
  | { status: "completed",        |
  |   result: "...", usage: {} }  |
  |<------------------------------|
```

## Job Lifecycle

Jobs progress through these statuses:

```
queued → running → completed
                 → failed
                 → cancelled
```

## API Endpoints

### `GET /jobs`

List all jobs.

```
GET /api/jobs
X-Scope-Id: user-123  (optional)

→ { jobs: [...], count: 5 }
```

### `GET /jobs/:id`

Get a job's current status and result.

```
GET /api/jobs/job_1234

→ {
    id: "job_1234",
    agentName: "email-checker",
    input: "Check my email",
    status: "completed",
    result: "Found 3 important emails...",
    usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    toolsUsed: ["searchEmails", "summarize"],
    createdAt: "2026-02-28T10:00:00Z",
    startedAt: "2026-02-28T10:00:01Z",
    completedAt: "2026-02-28T10:00:05Z"
  }
```

### `GET /jobs/:id/stream`

Reconnectable SSE stream. If the job is still running, replays buffered events then streams live. If already complete, replays all events.

```
GET /api/jobs/job_1234/stream

→ SSE stream with text-delta, tool-call, tool-result, done events
```

### `POST /jobs/:id/cancel`

Cancel a running or queued job.

```
POST /api/jobs/job_1234/cancel

→ { success: true }
```

### `DELETE /jobs/:id`

Delete a completed/failed/cancelled job record.

```
DELETE /api/jobs/job_1234

→ { success: true }
```

## Reconnectable SSE

The key feature that solves the client-disconnect problem. When an agent runs in async mode, SSE events are buffered in memory. If a client connects (or reconnects) to `/jobs/:id/stream`:

- **Job still running:** Replay all buffered events first, then continue streaming live events until the job completes.
- **Job completed:** Replay all buffered events, send `done`, close the stream.
- **Job not found:** Return 404.

This means if a user refreshes their browser mid-execution, they can reconnect and see the full history plus live updates.

The event buffer is in-memory (not persisted). If the server restarts, the buffer is lost — but the Job record in the store still captures the final result.

## Serverless / Edge Support

On serverless platforms (Vercel, Cloudflare Workers), the runtime shuts down after sending the response. Use the `waitUntil` config to keep background execution alive:

```typescript
// Cloudflare Workers
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const plugin = createAIPlugin({
      model: (id) => openrouter(id ?? MODEL),
      storage: createD1Storage(env.DB),
      waitUntil: (p) => ctx.waitUntil(p),
    });
    return plugin.router.fetch(request);
  },
};
```

```typescript
// Vercel Edge
import { waitUntil } from "@vercel/functions";

const plugin = createAIPlugin({
  model: (id) => openrouter(id ?? MODEL),
  storage: createFileStorage({ dataDir: "./data" }),
  waitUntil: (p) => waitUntil(p),
});
```

For jobs that exceed platform time limits, you'll need an external executor (similar to external cron schedulers).

## Storage

The `JobStore` is the 9th sub-store in `StorageProvider`. Like all kitn storage, it's mix-and-match:

```typescript
const storage: StorageProvider = {
  // ...other stores
  jobs: new PostgresJobStore(db),  // use any backend
};
```

Built-in implementations:
- **File-based** (`createFileStorage`) — stores jobs as JSON in `{dataDir}/jobs/`
- **In-memory** (`createMemoryStorage`) — ephemeral, lost on restart

## Lifecycle Hook Events

Background jobs emit lifecycle hooks (when [hooks are configured](./lifecycle-hooks.md)):

- `job:start` — job begins execution
- `job:end` — job completes successfully
- `job:cancelled` — job was cancelled
- `agent:start` / `agent:end` / `agent:error` — standard agent hooks (with `jobId` field)

```typescript
plugin.on("job:end", (event) => {
  notifyUser(event.agentName, event.output);
});
```

## Default Behavior (No Change)

Without `?async=true`, everything works exactly as before — synchronous SSE streaming or JSON responses. Background jobs are entirely opt-in.
