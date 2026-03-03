# KitnClaw Epic 2: Security, Remote Access, Web UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden KitnClaw with granular permissions, audit logging, credential encryption, remote access via WebSocket, a web chat UI, multi-user access control, and proactive scheduled actions.

**Architecture:** Build on Epic 1's foundation. Permission system v2 adds per-tool argument validation, per-channel policies, rate limiting, and a JSONL audit log. Remote access uses a Hono HTTP server embedded in the gateway (already has a port config). Web UI is a new channel backed by SSE. Multi-user adds a user/role system. Proactive actions wire @kitnai/core's existing cron infrastructure into KitnClaw.

**Tech Stack:** Bun, TypeScript, Hono (HTTP server), @kitnai/core (crons, lifecycle hooks), @libsql/client, keytar (OS keychain), Vercel AI SDK v6

**Design doc:** `docs/plans/2026-03-02-kitnclaw-design.md`
**Parent plan:** `docs/plans/2026-03-02-kitnclaw-plan.md` (Epic 2 section)

---

# Phase 1: Sandboxing

Enhance the permission system with granular policies, audit logging, and credential encryption.

---

## Task 1: Per-tool argument validation

Add the ability to restrict tool arguments — e.g., `bash` only for specific command prefixes, `file-write` only in certain directories.

**Files:**
- Modify: `packages/claw/src/permissions/manager.ts`
- Modify: `packages/claw/src/config/schema.ts`
- Test: `packages/claw/test/permissions.test.ts`

**Step 1: Write failing tests**

```ts
// Add to packages/claw/test/permissions.test.ts
describe("argument validation", () => {
  test("bash allowed when command matches prefix rule", () => {
    const pm = new PermissionManager({
      trusted: [],
      requireConfirmation: [],
      denied: [],
      rules: {
        bash: { allowPatterns: ["^(ls|cat|echo|git)\\b"] },
      },
    });
    expect(pm.checkWithArgs("bash", { command: "ls -la" })).toBe("allow");
    expect(pm.checkWithArgs("bash", { command: "echo hello" })).toBe("allow");
  });

  test("bash denied when command doesn't match prefix rule", () => {
    const pm = new PermissionManager({
      trusted: [],
      requireConfirmation: [],
      denied: [],
      rules: {
        bash: { allowPatterns: ["^(ls|cat|echo)\\b"] },
      },
    });
    expect(pm.checkWithArgs("bash", { command: "rm -rf /" })).toBe("deny");
  });

  test("file-write allowed when path matches directory rule", () => {
    const pm = new PermissionManager({
      trusted: [],
      requireConfirmation: [],
      denied: [],
      rules: {
        "file-write": { allowPaths: ["/home/user/projects/", "/tmp/"] },
      },
    });
    expect(pm.checkWithArgs("file-write", { path: "/home/user/projects/foo.ts" })).toBe("allow");
    expect(pm.checkWithArgs("file-write", { path: "/etc/passwd" })).toBe("deny");
  });

  test("tools without rules fall back to category-based check", () => {
    const pm = new PermissionManager({
      trusted: [],
      requireConfirmation: [],
      denied: [],
      rules: {},
    });
    expect(pm.checkWithArgs("file-read", {})).toBe("allow");
    expect(pm.checkWithArgs("bash", { command: "ls" })).toBe("confirm");
  });
});
```

**Step 2: Run tests to verify failure**

Run: `bun test packages/claw/test/permissions.test.ts`
Expected: FAIL — `checkWithArgs` doesn't exist, `rules` not in constructor

**Step 3: Update config schema to include rules**

Add to `packages/claw/src/config/schema.ts`:

```ts
const toolRuleSchema = z.object({
  allowPatterns: z.array(z.string()).optional(),
  allowPaths: z.array(z.string()).optional(),
  denyPatterns: z.array(z.string()).optional(),
  denyPaths: z.array(z.string()).optional(),
}).optional();

// Add to permissionsSchema:
const permissionsSchema = z.object({
  trusted: z.array(z.string()).default([]),
  requireConfirmation: z.array(z.string()).default([]),
  denied: z.array(z.string()).default([]),
  rules: z.record(z.string(), toolRuleSchema).default({}),
}).default({ trusted: [], requireConfirmation: [], denied: [], rules: {} });
```

**Step 4: Implement `checkWithArgs` in PermissionManager**

Add to `packages/claw/src/permissions/manager.ts`:

```ts
export interface ToolRule {
  allowPatterns?: string[];
  allowPaths?: string[];
  denyPatterns?: string[];
  denyPaths?: string[];
}

export interface PermissionsConfig {
  trusted: string[];
  requireConfirmation: string[];
  denied: string[];
  rules?: Record<string, ToolRule>;
}

// Inside PermissionManager class:
checkWithArgs(toolName: string, input: Record<string, unknown>): PermissionDecision {
  // Explicit deny/trust lists still take priority
  if (this.config.denied.includes(toolName)) return "deny";
  if (this.config.trusted.includes(toolName)) return "allow";
  if (this.sessionTrusted.has(toolName)) return "allow";

  // Check argument rules
  const rule = this.config.rules?.[toolName];
  if (rule) {
    // Check deny patterns first (deny wins over allow)
    if (rule.denyPatterns && typeof input.command === "string") {
      for (const pattern of rule.denyPatterns) {
        if (new RegExp(pattern).test(input.command)) return "deny";
      }
    }
    if (rule.denyPaths && typeof input.path === "string") {
      for (const pathPrefix of rule.denyPaths) {
        if (input.path.startsWith(pathPrefix)) return "deny";
      }
    }

    // Check allow patterns
    if (rule.allowPatterns && typeof input.command === "string") {
      for (const pattern of rule.allowPatterns) {
        if (new RegExp(pattern).test(input.command)) return "allow";
      }
      // Had allowPatterns but none matched → deny
      return "deny";
    }
    if (rule.allowPaths && typeof input.path === "string") {
      for (const pathPrefix of rule.allowPaths) {
        if (input.path.startsWith(pathPrefix)) return "allow";
      }
      return "deny";
    }
  }

  // Fall back to category-based check
  return this.check(toolName);
}
```

**Step 5: Run tests to verify pass**

Run: `bun test packages/claw/test/permissions.test.ts`
Expected: PASS

**Step 6: Wire `checkWithArgs` into wrapped-tools**

Modify `packages/claw/src/agent/wrapped-tools.ts` — change `permissions.check(reg.name)` to `permissions.checkWithArgs(reg.name, input)`:

```ts
// In the execute function:
execute: async (input: any) => {
  const decision = permissions.checkWithArgs(reg.name, input);
  // ... rest stays the same
```

**Step 7: Run all claw tests**

Run: `bun run --cwd packages/claw test`
Expected: All pass

**Step 8: Commit**

```bash
git add packages/claw/src/permissions/ packages/claw/src/config/schema.ts packages/claw/src/agent/wrapped-tools.ts packages/claw/test/permissions.test.ts
git commit -m "feat(claw): add per-tool argument validation rules"
```

---

## Task 2: Per-channel permission policies

Different trust levels for terminal vs Discord vs Telegram. Terminal is trusted (local user), messaging channels are restricted.

**Files:**
- Modify: `packages/claw/src/permissions/manager.ts`
- Modify: `packages/claw/src/config/schema.ts`
- Modify: `packages/claw/src/agent/loop.ts`
- Test: `packages/claw/test/permissions.test.ts`

**Step 1: Write failing tests**

```ts
describe("per-channel policies", () => {
  test("terminal channel inherits base permissions", () => {
    const pm = new PermissionManager({
      trusted: ["bash"],
      requireConfirmation: [],
      denied: [],
      rules: {},
    });
    expect(pm.checkForChannel("bash", "terminal", {})).toBe("allow");
  });

  test("discord channel has stricter permissions", () => {
    const pm = new PermissionManager({
      trusted: ["bash"],
      requireConfirmation: [],
      denied: [],
      rules: {},
      channelOverrides: {
        discord: { denied: ["bash", "file-write", "file-delete"] },
      },
    });
    // bash is trusted globally but denied on discord
    expect(pm.checkForChannel("bash", "discord", {})).toBe("deny");
    // file-read is safe everywhere
    expect(pm.checkForChannel("file-read", "discord", {})).toBe("allow");
  });

  test("channel override denied takes priority over global trusted", () => {
    const pm = new PermissionManager({
      trusted: ["bash"],
      requireConfirmation: [],
      denied: [],
      rules: {},
      channelOverrides: {
        telegram: { denied: ["bash"] },
      },
    });
    expect(pm.checkForChannel("bash", "terminal", {})).toBe("allow");
    expect(pm.checkForChannel("bash", "telegram", {})).toBe("deny");
  });
});
```

**Step 2: Run tests to verify failure**

Run: `bun test packages/claw/test/permissions.test.ts`
Expected: FAIL — `checkForChannel` doesn't exist

**Step 3: Update config schema**

Add to `packages/claw/src/config/schema.ts`:

```ts
const channelOverrideSchema = z.object({
  trusted: z.array(z.string()).optional(),
  denied: z.array(z.string()).optional(),
  requireConfirmation: z.array(z.string()).optional(),
});

// Add to permissionsSchema:
channelOverrides: z.record(z.string(), channelOverrideSchema).default({}),
```

**Step 4: Implement `checkForChannel`**

Add to `packages/claw/src/permissions/manager.ts`:

```ts
checkForChannel(
  toolName: string,
  channelType: string,
  input: Record<string, unknown>,
): PermissionDecision {
  // Channel-level denied always wins
  const override = this.config.channelOverrides?.[channelType];
  if (override?.denied?.includes(toolName)) return "deny";

  // Channel-level trusted
  if (override?.trusted?.includes(toolName)) return "allow";

  // Channel-level requireConfirmation
  if (override?.requireConfirmation?.includes(toolName)) return "confirm";

  // Fall through to argument-aware check
  return this.checkWithArgs(toolName, input);
}
```

**Step 5: Wire into agent loop**

Modify `packages/claw/src/agent/wrapped-tools.ts` to accept `channelType` and use `checkForChannel`:

```ts
export function wrapToolsWithPermissions(
  ctx: PluginContext,
  permissions: PermissionManager,
  handler: PermissionHandler,
  channelType: string = "terminal",
): Record<string, any> {
  // ...
  execute: async (input: any) => {
    const decision = permissions.checkForChannel(reg.name, channelType, input);
    // ...
```

Update `packages/claw/src/channels/manager.ts` to pass `channelType` through to `wrapToolsWithPermissions`. The `channelType` is already available in `handleMessage` as `message.channelType`.

Update `packages/claw/src/agent/loop.ts` to pass `channelType` to `wrapToolsWithPermissions`:

```ts
const wrappedTools = wrapToolsWithPermissions(ctx, permissions, permissionHandler, channelType);
```

**Step 6: Run all claw tests**

Run: `bun run --cwd packages/claw test`
Expected: All pass

**Step 7: Commit**

```bash
git add packages/claw/src/permissions/ packages/claw/src/config/schema.ts packages/claw/src/agent/ packages/claw/src/channels/manager.ts packages/claw/test/
git commit -m "feat(claw): add per-channel permission overrides"
```

---

## Task 3: Rate limiting

Prevent runaway tool execution — max N dangerous tool calls per minute.

**Files:**
- Create: `packages/claw/src/permissions/rate-limiter.ts`
- Modify: `packages/claw/src/permissions/manager.ts`
- Modify: `packages/claw/src/config/schema.ts`
- Test: `packages/claw/test/rate-limiter.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/rate-limiter.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { RateLimiter } from "../src/permissions/rate-limiter.js";

describe("RateLimiter", () => {
  test("allows calls within limit", () => {
    const rl = new RateLimiter({ maxPerMinute: 5 });
    for (let i = 0; i < 5; i++) {
      expect(rl.tryAcquire("bash")).toBe(true);
    }
  });

  test("blocks calls over limit", () => {
    const rl = new RateLimiter({ maxPerMinute: 3 });
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(false);
  });

  test("separate limits per tool", () => {
    const rl = new RateLimiter({ maxPerMinute: 2 });
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(false);
    // file-write has its own bucket
    expect(rl.tryAcquire("file-write")).toBe(true);
  });

  test("per-tool overrides", () => {
    const rl = new RateLimiter({
      maxPerMinute: 10,
      toolLimits: { bash: 2 },
    });
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(false);
    // other tools use default
    for (let i = 0; i < 10; i++) {
      expect(rl.tryAcquire("file-write")).toBe(true);
    }
  });

  test("resets after window expires", () => {
    const rl = new RateLimiter({ maxPerMinute: 1, windowMs: 100 });
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(false);
    // Wait for window to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(rl.tryAcquire("bash")).toBe(true);
        resolve();
      }, 150);
    });
  });
});
```

**Step 2: Run tests to verify failure**

Run: `bun test packages/claw/test/rate-limiter.test.ts`
Expected: FAIL — module not found

**Step 3: Implement RateLimiter**

Create `packages/claw/src/permissions/rate-limiter.ts`:

```ts
export interface RateLimiterConfig {
  maxPerMinute: number;
  toolLimits?: Record<string, number>;
  windowMs?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private config: Required<Pick<RateLimiterConfig, "maxPerMinute" | "windowMs">> & { toolLimits: Record<string, number> };
  private buckets = new Map<string, Bucket>();

  constructor(config: RateLimiterConfig) {
    this.config = {
      maxPerMinute: config.maxPerMinute,
      windowMs: config.windowMs ?? 60_000,
      toolLimits: config.toolLimits ?? {},
    };
  }

  tryAcquire(toolName: string): boolean {
    const now = Date.now();
    const limit = this.config.toolLimits[toolName] ?? this.config.maxPerMinute;

    let bucket = this.buckets.get(toolName);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.config.windowMs };
      this.buckets.set(toolName, bucket);
    }

    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }
}
```

**Step 4: Run tests**

Run: `bun test packages/claw/test/rate-limiter.test.ts`
Expected: PASS

**Step 5: Add rate limiting config to schema**

Add to `packages/claw/src/config/schema.ts` inside `permissionsSchema`:

```ts
rateLimits: z.object({
  maxPerMinute: z.number().default(30),
  toolLimits: z.record(z.string(), z.number()).default({}),
}).optional(),
```

**Step 6: Wire into PermissionManager**

Modify `packages/claw/src/permissions/manager.ts`:

```ts
import { RateLimiter, type RateLimiterConfig } from "./rate-limiter.js";

// In constructor:
private rateLimiter?: RateLimiter;

constructor(config: PermissionsConfig) {
  this.config = config;
  if (config.rateLimits) {
    this.rateLimiter = new RateLimiter(config.rateLimits);
  }
}

// In checkForChannel, after allow decision but before returning:
// Add rate limit check for non-safe tools
checkForChannel(toolName, channelType, input): PermissionDecision {
  // ... existing logic ...
  const decision = this.checkWithArgs(toolName, input);
  if (decision === "allow" && this.rateLimiter) {
    const category = getToolCategory(toolName);
    if (category !== "safe" && !this.rateLimiter.tryAcquire(toolName)) {
      return "deny"; // rate limited
    }
  }
  return decision;
}
```

**Step 7: Run all claw tests**

Run: `bun run --cwd packages/claw test`
Expected: All pass

**Step 8: Commit**

```bash
git add packages/claw/src/permissions/ packages/claw/src/config/schema.ts packages/claw/test/
git commit -m "feat(claw): add rate limiting for tool execution"
```

---

## Task 4: Audit log

Log all tool executions to `~/.kitnclaw/logs/audit.jsonl` via lifecycle hooks.

**Files:**
- Create: `packages/claw/src/audit/logger.ts`
- Modify: `packages/claw/src/gateway/start.ts`
- Test: `packages/claw/test/audit.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/audit.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { AuditLogger } from "../src/audit/logger.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-audit-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("AuditLogger", () => {
  test("logs tool execution events", async () => {
    const logger = new AuditLogger(join(tmpDir, "audit.jsonl"));

    await logger.logToolExecution({
      toolName: "bash",
      input: { command: "ls" },
      output: { exitCode: 0, stdout: "file.txt" },
      duration: 42,
      sessionId: "sess-1",
      channelType: "terminal",
      decision: "allow",
      timestamp: 1000,
    });

    const content = await readFile(join(tmpDir, "audit.jsonl"), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.event).toBe("tool:execute");
    expect(entry.toolName).toBe("bash");
    expect(entry.decision).toBe("allow");
    expect(entry.duration).toBe(42);
  });

  test("logs permission denials", async () => {
    const logger = new AuditLogger(join(tmpDir, "audit.jsonl"));

    await logger.logPermissionDenial({
      toolName: "bash",
      input: { command: "rm -rf /" },
      reason: "denied_by_rule",
      sessionId: "sess-1",
      channelType: "discord",
      timestamp: 2000,
    });

    const content = await readFile(join(tmpDir, "audit.jsonl"), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.event).toBe("permission:denied");
    expect(entry.reason).toBe("denied_by_rule");
  });

  test("appends multiple entries", async () => {
    const logger = new AuditLogger(join(tmpDir, "audit.jsonl"));

    await logger.logToolExecution({
      toolName: "file-read",
      input: { path: "/tmp/a" },
      output: { content: "hello" },
      duration: 5,
      sessionId: "s1",
      channelType: "terminal",
      decision: "allow",
      timestamp: 1000,
    });

    await logger.logToolExecution({
      toolName: "bash",
      input: { command: "echo hi" },
      output: { exitCode: 0, stdout: "hi" },
      duration: 10,
      sessionId: "s1",
      channelType: "terminal",
      decision: "allow",
      timestamp: 2000,
    });

    const lines = (await readFile(join(tmpDir, "audit.jsonl"), "utf-8"))
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `bun test packages/claw/test/audit.test.ts`
Expected: FAIL — module not found

**Step 3: Implement AuditLogger**

Create `packages/claw/src/audit/logger.ts`:

```ts
import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";

export interface ToolExecutionEntry {
  toolName: string;
  input: unknown;
  output: unknown;
  duration: number;
  sessionId: string;
  channelType: string;
  decision: string;
  timestamp: number;
}

export interface PermissionDenialEntry {
  toolName: string;
  input: unknown;
  reason: string;
  sessionId: string;
  channelType: string;
  timestamp: number;
}

export class AuditLogger {
  private path: string;
  private initialized = false;

  constructor(path: string) {
    this.path = path;
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.path), { recursive: true });
    this.initialized = true;
  }

  async logToolExecution(entry: ToolExecutionEntry): Promise<void> {
    await this.ensureDir();
    const line = JSON.stringify({
      event: "tool:execute",
      ...entry,
    });
    await appendFile(this.path, line + "\n");
  }

  async logPermissionDenial(entry: PermissionDenialEntry): Promise<void> {
    await this.ensureDir();
    const line = JSON.stringify({
      event: "permission:denied",
      ...entry,
    });
    await appendFile(this.path, line + "\n");
  }
}
```

**Step 4: Run tests**

Run: `bun test packages/claw/test/audit.test.ts`
Expected: PASS

**Step 5: Wire into gateway startup**

Modify `packages/claw/src/gateway/start.ts` to create an `AuditLogger` and subscribe to lifecycle hooks:

```ts
import { AuditLogger } from "../audit/logger.js";
import { join } from "path";
import { CLAW_HOME } from "../config/io.js";

// After creating plugin and registering tools:
const auditLogger = new AuditLogger(join(CLAW_HOME, "logs", "audit.jsonl"));

// Subscribe to tool execution events
if (plugin.hooks) {
  plugin.hooks.on("tool:execute", (event) => {
    auditLogger.logToolExecution({
      toolName: event.toolName,
      input: event.input,
      output: event.output,
      duration: event.duration,
      sessionId: event.conversationId ?? "",
      channelType: "",
      decision: "allow",
      timestamp: event.timestamp,
    });
  });
}
```

**Step 6: Run all claw tests**

Run: `bun run --cwd packages/claw test`
Expected: All pass

**Step 7: Commit**

```bash
git add packages/claw/src/audit/ packages/claw/src/gateway/start.ts packages/claw/test/audit.test.ts
git commit -m "feat(claw): add JSONL audit logging for tool executions"
```

---

## Task 5: Credential encryption (OS keychain)

Store API keys in the OS keychain instead of plaintext JSON.

**Files:**
- Create: `packages/claw/src/config/credentials.ts`
- Modify: `packages/claw/src/config/io.ts`
- Modify: `packages/claw/src/setup.ts`
- Modify: `packages/claw/package.json`
- Test: `packages/claw/test/credentials.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/credentials.test.ts
import { describe, test, expect } from "bun:test";
import { CredentialStore } from "../src/config/credentials.js";

describe("CredentialStore", () => {
  test("stores and retrieves credentials (file fallback)", async () => {
    // Use file-based fallback (doesn't require keychain)
    const store = new CredentialStore({ useKeychain: false, path: "/tmp/claw-test-creds" });
    await store.set("openai-key", "sk-test-123");
    const val = await store.get("openai-key");
    expect(val).toBe("sk-test-123");
    await store.delete("openai-key");
    expect(await store.get("openai-key")).toBeNull();
  });

  test("lists credential keys", async () => {
    const store = new CredentialStore({ useKeychain: false, path: "/tmp/claw-test-creds-2" });
    await store.set("key1", "val1");
    await store.set("key2", "val2");
    const keys = await store.list();
    expect(keys).toContain("key1");
    expect(keys).toContain("key2");
  });
});
```

**Step 2: Run tests to verify failure**

Run: `bun test packages/claw/test/credentials.test.ts`
Expected: FAIL — module not found

**Step 3: Implement CredentialStore with file fallback**

Create `packages/claw/src/config/credentials.ts`:

```ts
import { readFile, writeFile, mkdir, rm, readdir } from "fs/promises";
import { join, dirname } from "path";

interface CredentialStoreOptions {
  useKeychain?: boolean;
  path: string;
}

/**
 * Credential storage with OS keychain support and encrypted file fallback.
 *
 * keytar is optional — if not installed or keychain unavailable,
 * falls back to file-based storage in ~/.kitnclaw/credentials/.
 */
export class CredentialStore {
  private useKeychain: boolean;
  private path: string;
  private static SERVICE = "kitnclaw";

  constructor(options: CredentialStoreOptions) {
    this.useKeychain = options.useKeychain ?? true;
    this.path = options.path;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.useKeychain) {
      try {
        const keytar = await import("keytar");
        await keytar.setPassword(CredentialStore.SERVICE, key, value);
        return;
      } catch {
        // Keychain unavailable, fall through to file
      }
    }
    await mkdir(this.path, { recursive: true });
    // Base64 encode (not encryption, but prevents casual reading)
    await writeFile(join(this.path, key), Buffer.from(value).toString("base64"), {
      mode: 0o600,
    });
  }

  async get(key: string): Promise<string | null> {
    if (this.useKeychain) {
      try {
        const keytar = await import("keytar");
        return await keytar.getPassword(CredentialStore.SERVICE, key);
      } catch {
        // Fall through to file
      }
    }
    try {
      const encoded = await readFile(join(this.path, key), "utf-8");
      return Buffer.from(encoded, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (this.useKeychain) {
      try {
        const keytar = await import("keytar");
        await keytar.deletePassword(CredentialStore.SERVICE, key);
        return;
      } catch {
        // Fall through
      }
    }
    try {
      await rm(join(this.path, key));
    } catch {}
  }

  async list(): Promise<string[]> {
    if (this.useKeychain) {
      try {
        const keytar = await import("keytar");
        const creds = await keytar.findCredentials(CredentialStore.SERVICE);
        return creds.map((c) => c.account);
      } catch {
        // Fall through
      }
    }
    try {
      return await readdir(this.path);
    } catch {
      return [];
    }
  }
}
```

**Step 4: Run tests**

Run: `bun test packages/claw/test/credentials.test.ts`
Expected: PASS

**Step 5: Add keytar as optional dependency**

Modify `packages/claw/package.json`:
```json
"optionalDependencies": {
  "keytar": "^7.9.0"
}
```

Add `"keytar"` to the `external` array in `packages/claw/tsup.config.ts`.

**Step 6: Wire into config loading**

Modify `packages/claw/src/config/io.ts` — when loading config, check credential store for API key:

```ts
import { CredentialStore } from "./credentials.js";

const credentialStore = new CredentialStore({
  path: join(CLAW_HOME, "credentials"),
});

export async function loadConfig(): Promise<ClawConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const config = parseConfig(JSON.parse(raw));

    // If provider has no apiKey, try credential store
    if (config.provider && !config.provider.apiKey) {
      const storedKey = await credentialStore.get(`${config.provider.type}-api-key`);
      if (storedKey) {
        config.provider.apiKey = storedKey;
      }
    }

    return config;
  } catch {
    return parseConfig({});
  }
}

export { credentialStore };
```

**Step 7: Update setup wizard to use credential store**

Modify `packages/claw/src/setup.ts` — after getting the API key, store it in the credential store instead of plaintext config:

```ts
import { credentialStore } from "./config/io.js";

// After getting apiKey from user:
if (apiKey) {
  await credentialStore.set(`${providerType}-api-key`, apiKey);
  // Don't store apiKey in config file
  // config.provider.apiKey = undefined;
}
```

**Step 8: Run all claw tests**

Run: `bun run --cwd packages/claw test`
Expected: All pass

**Step 9: Commit**

```bash
git add packages/claw/src/config/credentials.ts packages/claw/src/config/io.ts packages/claw/src/setup.ts packages/claw/package.json packages/claw/tsup.config.ts packages/claw/test/credentials.test.ts
git commit -m "feat(claw): add credential store with OS keychain support"
```

---

# Phase 2: Remote Access

Add an HTTP server to the gateway and support remote TUI connections via WebSocket.

---

## Task 6: Embedded HTTP server

Add a Hono HTTP server to the gateway for remote API access.

**Files:**
- Create: `packages/claw/src/gateway/http.ts`
- Modify: `packages/claw/src/gateway/start.ts`
- Modify: `packages/claw/package.json`
- Test: `packages/claw/test/http.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/http.test.ts
import { describe, test, expect, afterEach } from "bun:test";

describe("HTTP server", () => {
  let server: any;

  afterEach(async () => {
    if (server) await server.stop();
  });

  test("health endpoint returns 200", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 }); // random port
    const addr = server.start();

    const res = await fetch(`http://localhost:${addr.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("status endpoint returns gateway info", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      getStatus: () => ({
        version: "0.1.0",
        uptime: 1000,
        channels: ["terminal"],
        tools: 12,
        sessions: 3,
      }),
    });
    const addr = server.start();

    const res = await fetch(`http://localhost:${addr.port}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toBe(12);
  });

  test("unauthenticated requests to /api are rejected when token set", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      authToken: "secret-token",
    });
    const addr = server.start();

    const res = await fetch(`http://localhost:${addr.port}/api/status`);
    expect(res.status).toBe(401);
  });

  test("authenticated requests pass with Bearer token", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      authToken: "secret-token",
      getStatus: () => ({ version: "0.1.0" }),
    });
    const addr = server.start();

    const res = await fetch(`http://localhost:${addr.port}/api/status`, {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `bun test packages/claw/test/http.test.ts`
Expected: FAIL — module not found

**Step 3: Add hono dependency**

Add to `packages/claw/package.json`:
```json
"hono": "^4.7.0"
```

Run: `bun install`

**Step 4: Implement HTTP server**

Create `packages/claw/src/gateway/http.ts`:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";

interface HttpServerOptions {
  port: number;
  bind?: string;
  authToken?: string;
  getStatus?: () => Record<string, unknown>;
}

export function createHttpServer(options: HttpServerOptions) {
  const app = new Hono();

  // CORS for web UI
  app.use("/*", cors());

  // Health check (no auth required)
  app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

  // Auth middleware for /api routes
  if (options.authToken) {
    app.use("/api/*", async (c, next) => {
      const auth = c.req.header("Authorization");
      if (auth !== `Bearer ${options.authToken}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      return next();
    });
  }

  // Status endpoint
  app.get("/api/status", (c) => {
    const status = options.getStatus?.() ?? {};
    return c.json(status);
  });

  let server: ReturnType<typeof Bun.serve> | null = null;

  return {
    app,
    start() {
      server = Bun.serve({
        port: options.port,
        hostname: options.bind === "lan" ? "0.0.0.0" : "127.0.0.1",
        fetch: app.fetch,
      });
      return { port: server.port, hostname: server.hostname };
    },
    stop() {
      server?.stop();
      server = null;
    },
    get port() {
      return server?.port;
    },
  };
}
```

**Step 5: Run tests**

Run: `bun test packages/claw/test/http.test.ts`
Expected: PASS

**Step 6: Wire into gateway startup**

Modify `packages/claw/src/gateway/start.ts`:

```ts
import { createHttpServer } from "./http.js";

// After creating channels, before startAll:
const httpServer = createHttpServer({
  port: config.gateway.port,
  bind: config.gateway.bind,
  authToken: config.gateway.authToken,
  getStatus: () => ({
    version: "0.1.0",
    uptime: Date.now() - startTime,
    channels: [...channels.listChannels()],
    tools: plugin.tools.list().length,
  }),
});

const addr = httpServer.start();
console.log(`[kitnclaw] HTTP server on http://${addr.hostname}:${addr.port}`);
```

Add `authToken` to gateway config in `packages/claw/src/config/schema.ts`:

```ts
const gatewaySchema = z.object({
  port: z.number().default(18800),
  bind: z.enum(["loopback", "lan"]).default("loopback"),
  authToken: z.string().optional(),
}).default({ port: 18800, bind: "loopback" as const });
```

**Step 7: Run all claw tests**

Run: `bun run --cwd packages/claw test`
Expected: All pass

**Step 8: Commit**

```bash
git add packages/claw/src/gateway/http.ts packages/claw/src/gateway/start.ts packages/claw/src/config/schema.ts packages/claw/package.json packages/claw/test/http.test.ts
git commit -m "feat(claw): add embedded HTTP server with auth"
```

---

## Task 7: Message API endpoint

Add POST /api/message and GET /api/stream for programmatic access.

**Files:**
- Modify: `packages/claw/src/gateway/http.ts`
- Test: `packages/claw/test/http.test.ts`

**Step 1: Write failing tests**

```ts
describe("message API", () => {
  test("POST /api/message returns agent response", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");

    const mockHandler = async (sessionId: string, text: string) => ({
      text: `Echo: ${text}`,
      toolCalls: [],
    });

    server = createHttpServer({
      port: 0,
      onMessage: mockHandler,
    });
    const addr = server.start();

    const res = await fetch(`http://localhost:${addr.port}/api/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "test-session",
        text: "Hello",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Echo: Hello");
  });

  test("POST /api/message validates input", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 });
    const addr = server.start();

    const res = await fetch(`http://localhost:${addr.port}/api/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // missing required fields
    });

    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run tests to verify failure**

**Step 3: Implement message endpoint**

Add to `packages/claw/src/gateway/http.ts`:

```ts
// In options interface:
onMessage?: (sessionId: string, text: string) => Promise<{ text: string; toolCalls: unknown[] }>;

// In app routes:
app.post("/api/message", async (c) => {
  const body = await c.req.json();
  if (!body.sessionId || !body.text) {
    return c.json({ error: "Missing sessionId or text" }, 400);
  }
  if (!options.onMessage) {
    return c.json({ error: "Message handler not configured" }, 503);
  }
  const response = await options.onMessage(body.sessionId, body.text);
  return c.json(response);
});
```

**Step 4: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): add POST /api/message endpoint"
```

---

## Task 8: Remote TUI via WebSocket

Allow a TUI client to connect to a remote gateway via WebSocket.

**Files:**
- Create: `packages/claw/src/channels/websocket-channel.ts`
- Modify: `packages/claw/src/gateway/http.ts`
- Modify: `packages/claw/src/index.ts` (add `connect` command)
- Test: `packages/claw/test/websocket.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/websocket.test.ts
import { describe, test, expect, afterEach } from "bun:test";

describe("WebSocket channel", () => {
  let server: any;

  afterEach(() => {
    server?.stop();
  });

  test("WebSocket upgrade succeeds with valid token", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      authToken: "test-token",
      onMessage: async (sid, text) => ({ text: `Echo: ${text}`, toolCalls: [] }),
    });
    const addr = server.start();

    const ws = new WebSocket(
      `ws://localhost:${addr.port}/ws?token=test-token`
    );

    const connected = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });

    expect(connected).toBe(true);
    ws.close();
  });

  test("WebSocket rejects invalid token", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      authToken: "test-token",
    });
    const addr = server.start();

    const ws = new WebSocket(
      `ws://localhost:${addr.port}/ws?token=wrong`
    );

    const rejected = await new Promise<boolean>((resolve) => {
      ws.onclose = () => resolve(true);
      ws.onopen = () => resolve(false);
      setTimeout(() => resolve(true), 2000);
    });

    expect(rejected).toBe(true);
  });

  test("sends message and receives response via WebSocket", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      onMessage: async (sid, text) => ({ text: `Echo: ${text}`, toolCalls: [] }),
    });
    const addr = server.start();

    const ws = new WebSocket(`ws://localhost:${addr.port}/ws`);

    const response = await new Promise<any>((resolve) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "message",
          sessionId: "ws-session-1",
          text: "Hello from WS",
        }));
      };
      ws.onmessage = (event) => {
        resolve(JSON.parse(event.data));
      };
      setTimeout(() => resolve(null), 3000);
    });

    expect(response).not.toBeNull();
    expect(response.text).toBe("Echo: Hello from WS");
    ws.close();
  });
});
```

**Step 2: Run tests to verify failure**

**Step 3: Add WebSocket upgrade to HTTP server**

Modify `packages/claw/src/gateway/http.ts` to handle WebSocket upgrades via Bun's native WebSocket support:

```ts
// In start():
server = Bun.serve({
  port: options.port,
  hostname: options.bind === "lan" ? "0.0.0.0" : "127.0.0.1",
  fetch(req, server) {
    // Handle WebSocket upgrade
    if (new URL(req.url).pathname === "/ws") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (options.authToken && token !== options.authToken) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (server.upgrade(req)) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }
    return app.fetch(req);
  },
  websocket: {
    async message(ws, message) {
      try {
        const data = JSON.parse(String(message));
        if (data.type === "message" && options.onMessage) {
          const response = await options.onMessage(data.sessionId, data.text);
          ws.send(JSON.stringify(response));
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ error: err.message }));
      }
    },
    open(ws) {},
    close(ws) {},
  },
});
```

**Step 4: Add `connect` command to CLI**

Modify `packages/claw/src/index.ts`:

```ts
program
  .command("connect")
  .description("Connect to a remote KitnClaw gateway")
  .argument("<url>", "WebSocket URL (ws://host:port)")
  .option("-t, --token <token>", "Auth token")
  .action(async (url, opts) => {
    const { connectRemote } = await import("./gateway/connect.js");
    await connectRemote(url, opts.token);
  });
```

Create `packages/claw/src/gateway/connect.ts` — a minimal remote TUI client that opens a WebSocket, sends messages, and displays responses.

**Step 5: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): add WebSocket remote access and connect command"
```

---

# Phase 3: Web UI Channel

Add a web-based chat interface served by the gateway's HTTP server.

---

## Task 9: Web channel with SSE streaming

**Files:**
- Create: `packages/claw/src/channels/web-channel.ts`
- Modify: `packages/claw/src/gateway/http.ts`
- Test: `packages/claw/test/web-channel.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/web-channel.test.ts
import { describe, test, expect, afterEach } from "bun:test";

describe("web channel", () => {
  let server: any;
  afterEach(() => server?.stop());

  test("GET /api/stream returns SSE content type", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 });
    const addr = server.start();

    const res = await fetch(
      `http://localhost:${addr.port}/api/stream?sessionId=test`
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // Close to avoid hanging
    await res.body?.cancel();
  });
});
```

**Step 2: Implement SSE endpoint**

Add to `packages/claw/src/gateway/http.ts`:

```ts
// SSE stream for a session
app.get("/api/stream", (c) => {
  const sessionId = c.req.query("sessionId");
  if (!sessionId) return c.json({ error: "Missing sessionId" }, 400);

  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        // Register this stream for the session
        options.onStreamConnect?.(sessionId, send);

        // Send initial connected event
        send("connected", { sessionId });
      },
      cancel() {
        options.onStreamDisconnect?.(sessionId);
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }
  );
});
```

**Step 3: Run tests, verify pass. Commit.**

---

## Task 10: Static web chat UI

Serve a minimal but functional web chat interface from the gateway.

**Files:**
- Create: `packages/claw/src/web/index.html`
- Create: `packages/claw/src/web/chat.js`
- Create: `packages/claw/src/web/style.css`
- Modify: `packages/claw/src/gateway/http.ts`

**Step 1: Create static web UI**

The web UI is a single-page app (vanilla HTML/JS/CSS — no build step) that:
- Connects to `/api/stream` via SSE for responses
- Sends messages via `POST /api/message`
- Renders markdown in assistant responses
- Shows tool call cards
- Has a mobile-responsive layout
- Dark theme matching the terminal TUI

**Step 2: Serve static files**

Add to `packages/claw/src/gateway/http.ts`:

```ts
import { readFile } from "fs/promises";
import { join } from "path";

// Serve web UI at root
app.get("/", async (c) => {
  const html = await readFile(join(__dirname, "../web/index.html"), "utf-8");
  return c.html(html);
});
app.get("/chat.js", async (c) => {
  const js = await readFile(join(__dirname, "../web/chat.js"), "utf-8");
  return c.text(js, 200, { "Content-Type": "application/javascript" });
});
app.get("/style.css", async (c) => {
  const css = await readFile(join(__dirname, "../web/style.css"), "utf-8");
  return c.text(css, 200, { "Content-Type": "text/css" });
});
```

**Step 3: Include web files in build**

Add to `packages/claw/tsup.config.ts`:
```ts
// Copy web assets to dist
import { cpSync } from "fs";
// Use onSuccess hook or add a postbuild script
```

Or use `publicDir` pattern — embed the HTML as a string constant.

**Step 4: Test manually**

Start gateway, open `http://localhost:18800` in browser, verify the chat UI loads and you can send messages.

**Step 5: Commit**

```bash
git commit -m "feat(claw): add web chat UI channel"
```

---

# Phase 4: Multi-User Access Control

Add a user/role system with per-user permissions and channel-level pairing.

---

## Task 11: User and role system

**Files:**
- Create: `packages/claw/src/users/manager.ts`
- Modify: `packages/claw/src/config/schema.ts`
- Test: `packages/claw/test/users.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/users.test.ts
import { describe, test, expect } from "bun:test";
import { UserManager } from "../src/users/manager.js";

describe("UserManager", () => {
  test("recognizes operator role", () => {
    const um = new UserManager({
      admin: { role: "operator", channels: ["*"] },
    });
    expect(um.getRole("admin")).toBe("operator");
    expect(um.canAccessChannel("admin", "terminal")).toBe(true);
    expect(um.canAccessChannel("admin", "discord")).toBe(true);
  });

  test("guest role has restricted tools", () => {
    const um = new UserManager({
      friend: { role: "guest", channels: ["telegram"], tools: { denied: ["bash"] } },
    });
    expect(um.getRole("friend")).toBe("guest");
    expect(um.canAccessChannel("friend", "telegram")).toBe(true);
    expect(um.canAccessChannel("friend", "discord")).toBe(false);
    expect(um.getToolOverrides("friend")).toEqual({ denied: ["bash"] });
  });

  test("unknown users are unauthorized", () => {
    const um = new UserManager({});
    expect(um.getRole("stranger")).toBe("unauthorized");
    expect(um.canAccessChannel("stranger", "terminal")).toBe(false);
  });

  test("terminal always allows owner", () => {
    const um = new UserManager({});
    // Terminal is special — the local user is always the owner
    expect(um.isOwner("terminal")).toBe(true);
  });
});
```

**Step 2: Run tests to verify failure**

**Step 3: Add users to config schema**

```ts
const userSchema = z.object({
  role: z.enum(["operator", "user", "guest"]),
  channels: z.array(z.string()).default(["*"]),
  tools: z.object({
    trusted: z.array(z.string()).optional(),
    denied: z.array(z.string()).optional(),
  }).optional(),
});

// Add to configSchema:
users: z.record(z.string(), userSchema).default({}),
```

**Step 4: Implement UserManager**

Create `packages/claw/src/users/manager.ts`:

```ts
export type Role = "operator" | "user" | "guest" | "unauthorized";

interface UserConfig {
  role: "operator" | "user" | "guest";
  channels: string[];
  tools?: { trusted?: string[]; denied?: string[] };
}

export class UserManager {
  private users: Record<string, UserConfig>;

  constructor(users: Record<string, UserConfig>) {
    this.users = users;
  }

  getRole(userId: string): Role {
    return this.users[userId]?.role ?? "unauthorized";
  }

  canAccessChannel(userId: string, channelType: string): boolean {
    const user = this.users[userId];
    if (!user) return false;
    return user.channels.includes("*") || user.channels.includes(channelType);
  }

  getToolOverrides(userId: string): { trusted?: string[]; denied?: string[] } | undefined {
    return this.users[userId]?.tools;
  }

  isOwner(channelType: string): boolean {
    return channelType === "terminal";
  }
}
```

**Step 5: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): add user/role system for multi-user access"
```

---

## Task 12: Channel-level pairing

Unknown users on messaging channels must be approved via pairing codes.

**Files:**
- Create: `packages/claw/src/users/pairing.ts`
- Test: `packages/claw/test/pairing.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/pairing.test.ts
import { describe, test, expect } from "bun:test";
import { PairingManager } from "../src/users/pairing.js";

describe("PairingManager", () => {
  test("generates pairing codes", () => {
    const pm = new PairingManager();
    const code = pm.createCode("discord", "user123");
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  test("validates correct code", () => {
    const pm = new PairingManager();
    const code = pm.createCode("discord", "user123");
    const result = pm.validate(code);
    expect(result).toEqual({ channel: "discord", userId: "user123" });
  });

  test("rejects invalid code", () => {
    const pm = new PairingManager();
    const result = pm.validate("XXXXXX");
    expect(result).toBeNull();
  });

  test("codes expire after TTL", async () => {
    const pm = new PairingManager({ ttlMs: 100 });
    const code = pm.createCode("telegram", "user456");
    await new Promise((r) => setTimeout(r, 150));
    expect(pm.validate(code)).toBeNull();
  });

  test("codes are single-use", () => {
    const pm = new PairingManager();
    const code = pm.createCode("discord", "user123");
    expect(pm.validate(code)).not.toBeNull();
    expect(pm.validate(code)).toBeNull(); // second use fails
  });
});
```

**Step 2: Implement PairingManager**

Create `packages/claw/src/users/pairing.ts`:

```ts
interface PairingEntry {
  channel: string;
  userId: string;
  expiresAt: number;
}

interface PairingManagerOptions {
  ttlMs?: number;
}

export class PairingManager {
  private codes = new Map<string, PairingEntry>();
  private ttlMs: number;

  constructor(options?: PairingManagerOptions) {
    this.ttlMs = options?.ttlMs ?? 5 * 60_000; // 5 minutes default
  }

  createCode(channel: string, userId: string): string {
    const code = this.generateCode();
    this.codes.set(code, {
      channel,
      userId,
      expiresAt: Date.now() + this.ttlMs,
    });
    return code;
  }

  validate(code: string): { channel: string; userId: string } | null {
    const entry = this.codes.get(code);
    if (!entry) return null;

    // Single-use: delete immediately
    this.codes.delete(code);

    // Check expiry
    if (Date.now() > entry.expiresAt) return null;

    return { channel: entry.channel, userId: entry.userId };
  }

  private generateCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }
}
```

**Step 3: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): add pairing system for messaging channel users"
```

---

# Phase 5: Proactive Actions

Wire @kitnai/core's cron infrastructure into KitnClaw and add HEARTBEAT.md support.

---

## Task 13: Wire cron scheduler into gateway

**Files:**
- Create: `packages/claw/src/crons/setup.ts`
- Modify: `packages/claw/src/gateway/start.ts`
- Modify: `packages/claw/src/gateway/create-plugin.ts`
- Test: `packages/claw/test/crons.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/crons.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "claw-cron-"));
});

afterEach(async () => {
  await rm(tmpHome, { recursive: true, force: true });
});

describe("cron integration", () => {
  test("scheduler ticks and finds no due jobs", async () => {
    const { createClawPlugin } = await import("../src/gateway/create-plugin.js");
    const { parseConfig } = await import("../src/config/schema.js");
    const { setupCronScheduler } = await import("../src/crons/setup.js");
    const config = parseConfig({
      provider: { type: "openai", apiKey: "test-key" },
    });

    const plugin = createClawPlugin(config, tmpHome);
    const scheduler = setupCronScheduler(plugin);

    // Tick should complete without error (no jobs)
    await scheduler.tick();
  });

  test("scheduler executes a due cron job", async () => {
    const { createClawPlugin } = await import("../src/gateway/create-plugin.js");
    const { parseConfig } = await import("../src/config/schema.js");
    const { setupCronScheduler } = await import("../src/crons/setup.js");
    const config = parseConfig({
      provider: { type: "openai", apiKey: "test-key" },
    });

    const plugin = createClawPlugin(config, tmpHome);
    const scheduler = setupCronScheduler(plugin);

    // Create a due job
    await plugin.storage.crons.create({
      name: "test-job",
      agentName: "kitnclaw",
      schedule: "* * * * *",
      input: "Say hello",
      enabled: true,
      nextRun: new Date(Date.now() - 1000), // already due
    });

    // Note: tick will try to run the agent, which will fail without a real provider.
    // That's expected — we're testing the scheduler wiring, not the agent.
    const completed: string[] = [];
    const errors: string[] = [];

    const s = setupCronScheduler(plugin, {
      onComplete: (job) => completed.push(job.name),
      onError: (job) => errors.push(job.name),
    });

    await s.tick();

    // Job should have attempted execution (error expected without real AI)
    expect(completed.length + errors.length).toBe(1);
  });
});
```

**Step 2: Implement cron setup**

Create `packages/claw/src/crons/setup.ts`:

```ts
import { createInternalScheduler, type InternalSchedulerOptions } from "@kitnai/core";
import type { PluginContext } from "@kitnai/core";

export function setupCronScheduler(
  ctx: PluginContext,
  options?: InternalSchedulerOptions,
) {
  return createInternalScheduler(ctx, {
    interval: options?.interval ?? 60_000,
    onComplete: options?.onComplete,
    onError: options?.onError ?? ((job, err) => {
      console.error(`[kitnclaw] Cron job "${job.name}" failed:`, err.message);
    }),
  });
}
```

**Step 3: Wire into gateway startup**

Modify `packages/claw/src/gateway/start.ts`:

```ts
import { setupCronScheduler } from "../crons/setup.js";

// After registering tools:
const scheduler = setupCronScheduler(plugin);
scheduler.start();
console.log("[kitnclaw] Cron scheduler started");

// In SIGINT handler:
scheduler.stop();
```

**Step 4: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): wire cron scheduler into gateway"
```

---

## Task 14: HEARTBEAT.md parser and scheduler

Parse `~/.kitnclaw/workspace/HEARTBEAT.md` into cron jobs.

**Files:**
- Create: `packages/claw/src/crons/heartbeat.ts`
- Test: `packages/claw/test/heartbeat.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/heartbeat.test.ts
import { describe, test, expect } from "bun:test";
import { parseHeartbeat } from "../src/crons/heartbeat.js";

describe("HEARTBEAT.md parser", () => {
  test("parses morning schedule", () => {
    const md = `## Every Morning (9:00 AM)
- Check email for urgent messages
- Summarize calendar for the day
`;
    const jobs = parseHeartbeat(md);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("every-morning-9-00-am");
    expect(jobs[0].schedule).toBe("0 9 * * *");
    expect(jobs[0].input).toContain("Check email");
    expect(jobs[0].input).toContain("Summarize calendar");
  });

  test("parses hourly schedule", () => {
    const md = `## Every Hour
- Check Discord mentions
`;
    const jobs = parseHeartbeat(md);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 * * * *");
  });

  test("parses daily schedule with time", () => {
    const md = `## Daily at 6:00 PM
- Generate daily report
- Send summary to Telegram
`;
    const jobs = parseHeartbeat(md);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("0 18 * * *");
  });

  test("parses multiple sections", () => {
    const md = `## Every Morning (8:00 AM)
- Task A

## Every Hour
- Task B

## Every Friday at 5:00 PM
- Task C
`;
    const jobs = parseHeartbeat(md);
    expect(jobs).toHaveLength(3);
  });

  test("ignores non-schedule sections", () => {
    const md = `## About
This is my heartbeat config.

## Every Hour
- Do something
`;
    const jobs = parseHeartbeat(md);
    expect(jobs).toHaveLength(1);
  });
});
```

**Step 2: Implement HEARTBEAT.md parser**

Create `packages/claw/src/crons/heartbeat.ts`:

```ts
export interface HeartbeatJob {
  name: string;
  schedule: string;
  input: string;
}

const SCHEDULE_PATTERNS: Array<{
  pattern: RegExp;
  toCron: (match: RegExpMatchArray) => string;
}> = [
  {
    pattern: /every\s+morning\s*\((\d{1,2}):(\d{2})\s*(am|pm)\)/i,
    toCron: (m) => {
      let hour = parseInt(m[1]);
      if (m[3].toLowerCase() === "pm" && hour !== 12) hour += 12;
      if (m[3].toLowerCase() === "am" && hour === 12) hour = 0;
      return `${parseInt(m[2])} ${hour} * * *`;
    },
  },
  {
    pattern: /every\s+hour/i,
    toCron: () => "0 * * * *",
  },
  {
    pattern: /daily\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i,
    toCron: (m) => {
      let hour = parseInt(m[1]);
      if (m[3].toLowerCase() === "pm" && hour !== 12) hour += 12;
      if (m[3].toLowerCase() === "am" && hour === 12) hour = 0;
      return `${parseInt(m[2])} ${hour} * * *`;
    },
  },
  {
    pattern: /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i,
    toCron: (m) => {
      const days: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6,
      };
      const day = days[m[1].toLowerCase()];
      let hour = parseInt(m[2]);
      if (m[4].toLowerCase() === "pm" && hour !== 12) hour += 12;
      if (m[4].toLowerCase() === "am" && hour === 12) hour = 0;
      return `${parseInt(m[3])} ${hour} * * ${day}`;
    },
  },
];

export function parseHeartbeat(markdown: string): HeartbeatJob[] {
  const jobs: HeartbeatJob[] = [];
  const sections = markdown.split(/^##\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.trim().split("\n");
    const heading = lines[0].trim();

    // Try to match a schedule pattern
    let schedule: string | null = null;
    for (const { pattern, toCron } of SCHEDULE_PATTERNS) {
      const match = heading.match(pattern);
      if (match) {
        schedule = toCron(match);
        break;
      }
    }

    if (!schedule) continue;

    // Extract task items (lines starting with -)
    const tasks = lines
      .slice(1)
      .filter((l) => l.trim().startsWith("-"))
      .map((l) => l.trim().replace(/^-\s*/, ""))
      .filter(Boolean);

    if (tasks.length === 0) continue;

    const name = heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    jobs.push({
      name,
      schedule,
      input: tasks.join("\n"),
    });
  }

  return jobs;
}
```

**Step 3: Run tests, verify pass.**

**Step 4: Add heartbeat loading to gateway startup**

```ts
import { readFile } from "fs/promises";
import { join } from "path";
import { parseHeartbeat } from "../crons/heartbeat.js";
import { CLAW_HOME } from "../config/io.js";

// In startGateway, after cron scheduler start:
try {
  const heartbeatPath = join(CLAW_HOME, "workspace", "HEARTBEAT.md");
  const heartbeatMd = await readFile(heartbeatPath, "utf-8");
  const heartbeatJobs = parseHeartbeat(heartbeatMd);

  for (const job of heartbeatJobs) {
    await plugin.storage.crons.create({
      name: `heartbeat:${job.name}`,
      agentName: "kitnclaw",
      schedule: job.schedule,
      input: job.input,
      enabled: true,
      nextRun: new Date(), // calculate from cron expression
    });
  }

  if (heartbeatJobs.length > 0) {
    console.log(`[kitnclaw] Loaded ${heartbeatJobs.length} heartbeat jobs`);
  }
} catch {
  // No HEARTBEAT.md — that's fine
}
```

**Step 5: Commit**

```bash
git commit -m "feat(claw): add HEARTBEAT.md parser and cron scheduling"
```

---

## Task 15: Final build, typecheck, and verification

**Step 1: Run typecheck**

```bash
bun run typecheck
```
Expected: All 16+ packages pass

**Step 2: Run all tests**

```bash
bun run test
```
Expected: All tests pass

**Step 3: Build**

```bash
bun run build
```
Expected: Clean build

**Step 4: Smoke test**

- `kitnclaw status` — verify new config fields appear
- `kitnclaw --help` — verify `connect` command shows
- Open `http://localhost:18800/health` — verify HTTP server responds
- Open `http://localhost:18800/` — verify web UI loads

**Step 5: Commit any remaining fixes**

```bash
git commit -m "chore(claw): Epic 2 final verification and cleanup"
```

---

# Implementation Order Summary

| Task | Phase | Description | Files |
|------|-------|-------------|-------|
| 1 | Sandboxing | Per-tool argument validation | permissions/manager.ts, config/schema.ts |
| 2 | Sandboxing | Per-channel permission overrides | permissions/manager.ts, agent/loop.ts |
| 3 | Sandboxing | Rate limiting | permissions/rate-limiter.ts (CREATE) |
| 4 | Sandboxing | Audit logging | audit/logger.ts (CREATE) |
| 5 | Sandboxing | Credential encryption | config/credentials.ts (CREATE) |
| 6 | Remote Access | Embedded HTTP server | gateway/http.ts (CREATE) |
| 7 | Remote Access | Message API endpoint | gateway/http.ts |
| 8 | Remote Access | WebSocket remote TUI | channels/websocket-channel.ts (CREATE) |
| 9 | Web UI | SSE streaming endpoint | gateway/http.ts |
| 10 | Web UI | Static web chat UI | web/index.html (CREATE) |
| 11 | Multi-User | User/role system | users/manager.ts (CREATE) |
| 12 | Multi-User | Channel pairing | users/pairing.ts (CREATE) |
| 13 | Proactive | Cron scheduler wiring | crons/setup.ts (CREATE) |
| 14 | Proactive | HEARTBEAT.md parser | crons/heartbeat.ts (CREATE) |
| 15 | Final | Build + typecheck + smoke test | — |
