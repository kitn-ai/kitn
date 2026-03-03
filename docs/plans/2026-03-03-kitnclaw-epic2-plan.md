# KitnClaw Epic 2: Security, Remote Access, Web UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden KitnClaw with a user-friendly permission system (safety profiles, plain-language prompts, directory sandboxing), per-action governance (budgets, draft mode, posting limits), audit logging, credential encryption, remote access via WebSocket, a web chat UI, multi-user access control, and proactive scheduled actions.

**Architecture:** Build on Epic 1's foundation. The permission system is redesigned around three layers: (1) safety profiles with plain-language prompts for end users, (2) per-action governance policies (draft/auto/blocked + budgets) for sensitive actions, and (3) config-level firewall rules for advanced users. A directory sandbox model gives the assistant free access to its workspace and user-granted directories. Budget enforcement happens at the tool level — the AI cannot override spending limits because the tool's execute function checks the ledger before acting. Actions in "draft" mode execute but produce a draft that the user must approve before it takes effect. Remote access uses a Hono HTTP server. Web UI is a channel backed by SSE. Multi-user adds roles with pairing. Proactive actions wire @kitnai/core's cron infrastructure.

**Tech Stack:** Bun, TypeScript, Hono (HTTP server), @kitnai/core (crons, lifecycle hooks), @libsql/client, keytar (OS keychain), Vercel AI SDK v6

**Design doc:** `docs/plans/2026-03-02-kitnclaw-design.md`
**Parent plan:** `docs/plans/2026-03-02-kitnclaw-plan.md` (Epic 2 section)

---

## Security Model Overview

**Target audience:** Non-technical users. KitnClaw is a personal AI assistant for daily life and work — not a developer tool. Permission prompts must be understandable by someone who doesn't know what "bash" means.

### Two Layers

**Layer 1 — Safety Profiles (user-facing):**
Three profiles selected during setup. Control what the assistant can do autonomously vs. what it asks about.

| Action | Cautious | Balanced (default) | Autonomous |
|--------|----------|-------------------|------------|
| Read files (anywhere) | Ask | Auto | Auto |
| Write files (sandbox + granted dirs) | Ask | Auto | Auto |
| Write files (elsewhere) | Ask | Ask | Auto |
| Web search / fetch | Ask | Auto | Auto |
| Memory save/search | Auto | Auto | Auto |
| Shell commands | Ask | Ask | Auto |
| Delete files | Ask | Ask | Ask |
| Send messages as user | Ask | Ask | Ask |
| Spend money (paid APIs) | Ask | Ask | Ask |
| Install components (kitn add) | Ask | Ask | Auto |

**Layer 2 — Firewall Rules (config-level, advanced):**
For power users / admins. Per-tool argument patterns, per-channel overrides, rate limits. Most users never touch this.

### Directory Sandbox

- `~/.kitnclaw/workspace/` — always free, no prompts needed
- **Granted directories** — user adds folders during setup or at runtime (e.g., `~/Documents`, `~/Projects/my-app`). Stored in config, remembered across sessions.
- **Everything else** — requires permission based on safety profile

### Plain-Language Prompts

When the assistant does need to ask, it explains in human terms:

```
KitnClaw wants to save a file to your Desktop.
  📄 ~/Desktop/meeting-notes.txt

  [Allow] [Deny] [Always allow files to Desktop]
```

Not:
```
file-write({ path: "/Users/joe/Desktop/meeting-notes.txt" }) requires confirmation [Y/N/A]
```

The "Always allow" option grants the parent directory, which is remembered as a granted directory.

### Per-Action Governance

Sensitive actions have three modes (configurable per action):

| Mode | Behavior |
|------|----------|
| **Blocked** | Action cannot be performed at all |
| **Draft** | Action executes but produces a draft/preview. User must approve before it takes effect (e.g., message drafted but not sent, post composed but not published, purchase prepared but not confirmed). |
| **Auto** | Action executes immediately with no human in the loop |

Default governance (can be changed per-action in config):

| Action | Default Mode |
|--------|-------------|
| Send messages (email, Slack, etc.) | Draft |
| Post publicly (social media, forums) | Draft |
| Schedule future actions | Draft |
| Spend money | Budget-capped (see below) |
| Delete files | Blocked (requires per-instance approval) |

### Budget Enforcement

Spending is enforced at the **tool level** — the AI cannot override it because the tool's `execute()` function checks a budget ledger before acting.

```json
{
  "governance": {
    "budgets": {
      "amazon.com": { "limit": 100, "period": "monthly" },
      "default": { "limit": 0, "period": "monthly" }
    }
  }
}
```

- Each domain/service has a spending cap and reset period
- A `BudgetLedger` (libSQL) tracks all spending with timestamps
- When a tool attempts to spend money, it checks: `current_spend + amount <= limit`
- If over budget → tool returns an error to the AI (not a permission prompt — a hard block)
- The AI literally cannot spend more than allocated
- `default: 0` means spending is blocked on unlisted services

### Draft Queue

Actions in "draft" mode produce a `DraftEntry` stored in the libSQL database (`~/.kitnclaw/claw.db`):

```ts
interface DraftEntry {
  id: string;
  action: string;         // "send-email", "post-tweet", "schedule-job"
  toolName: string;
  input: Record<string, unknown>;
  preview: string;         // Human-readable preview of what will happen
  createdAt: string;
  sessionId: string;
  status: "pending" | "approved" | "rejected";
}
```

Users review drafts in the TUI (`/drafts` command) or web UI. Approving a draft executes the original tool call. Rejecting discards it.

---

# Phase 1: Permission System v2

Rebuild the permission system with safety profiles, directory sandboxing, plain-language prompts, and progressive trust.

---

## Task 1: Safety profiles and directory sandbox

Replace the current category-based permission system with safety profiles and directory-scoped access.

**Files:**
- Create: `packages/claw/src/permissions/profiles.ts`
- Rewrite: `packages/claw/src/permissions/manager.ts`
- Modify: `packages/claw/src/config/schema.ts`
- Test: `packages/claw/test/permissions.test.ts`

**Step 1: Write failing tests**

```ts
// Replace packages/claw/test/permissions.test.ts
import { describe, test, expect } from "bun:test";
import { PermissionManager } from "../src/permissions/manager.js";

describe("PermissionManager", () => {
  describe("safety profiles", () => {
    test("balanced profile auto-allows reads", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-read", { path: "/any/path" })).toBe("allow");
    });

    test("balanced profile auto-allows writes in sandbox", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/tmp/test-workspace/notes.md" })).toBe("allow");
    });

    test("balanced profile asks for writes outside sandbox", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/home/user/Desktop/file.txt" })).toBe("confirm");
    });

    test("balanced profile auto-allows writes in granted dirs", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: ["/home/user/Documents"],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/home/user/Documents/notes.md" })).toBe("allow");
    });

    test("balanced profile asks for shell commands", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("bash", { command: "ls" })).toBe("confirm");
    });

    test("balanced profile auto-allows web search", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("web-search", {})).toBe("allow");
    });

    test("cautious profile asks for everything except memory", () => {
      const pm = new PermissionManager({
        profile: "cautious",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-read", { path: "/tmp/a" })).toBe("confirm");
      expect(pm.evaluate("web-search", {})).toBe("confirm");
      expect(pm.evaluate("memory-save", {})).toBe("allow");
      expect(pm.evaluate("memory-search", {})).toBe("allow");
    });

    test("autonomous profile auto-allows most things", () => {
      const pm = new PermissionManager({
        profile: "autonomous",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/anywhere/file.txt" })).toBe("allow");
      expect(pm.evaluate("bash", { command: "ls" })).toBe("allow");
      expect(pm.evaluate("web-search", {})).toBe("allow");
    });

    test("all profiles always ask for deletes", () => {
      for (const profile of ["cautious", "balanced", "autonomous"] as const) {
        const pm = new PermissionManager({
          profile,
          grantedDirs: [],
          sandbox: "/tmp/test-workspace",
        });
        expect(pm.evaluate("file-delete", { path: "/tmp/file" })).toBe("confirm");
      }
    });

    test("all profiles always ask for send-message", () => {
      for (const profile of ["cautious", "balanced", "autonomous"] as const) {
        const pm = new PermissionManager({
          profile,
          grantedDirs: [],
          sandbox: "/tmp/test-workspace",
        });
        expect(pm.evaluate("send-message", {})).toBe("confirm");
      }
    });
  });

  describe("progressive trust", () => {
    test("granting a directory remembers it", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("file-write", { path: "/home/user/Desktop/a.txt" })).toBe("confirm");

      pm.grantDirectory("/home/user/Desktop");

      expect(pm.evaluate("file-write", { path: "/home/user/Desktop/a.txt" })).toBe("allow");
      expect(pm.evaluate("file-write", { path: "/home/user/Desktop/sub/b.txt" })).toBe("allow");
    });

    test("session trust works for non-file tools", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      expect(pm.evaluate("bash", { command: "ls" })).toBe("confirm");

      pm.trustForSession("bash");

      expect(pm.evaluate("bash", { command: "ls" })).toBe("allow");
    });

    test("session trust does not affect always-ask tools", () => {
      const pm = new PermissionManager({
        profile: "balanced",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
      });
      pm.trustForSession("file-delete");
      // Deletes always ask regardless of trust
      expect(pm.evaluate("file-delete", { path: "/tmp/x" })).toBe("confirm");
    });
  });

  describe("explicit deny list (backward compat)", () => {
    test("denied tools are always denied", () => {
      const pm = new PermissionManager({
        profile: "autonomous",
        grantedDirs: [],
        sandbox: "/tmp/test-workspace",
        denied: ["bash"],
      });
      expect(pm.evaluate("bash", { command: "ls" })).toBe("deny");
    });
  });
});
```

**Step 2: Run tests to verify failure**

Run: `bun test packages/claw/test/permissions.test.ts`
Expected: FAIL — new constructor signature, `evaluate` doesn't exist

**Step 3: Define safety profiles**

Create `packages/claw/src/permissions/profiles.ts`:

```ts
export type SafetyProfile = "cautious" | "balanced" | "autonomous";

export type ActionType =
  | "read-file"
  | "write-file-sandbox"
  | "write-file-granted"
  | "write-file-other"
  | "web-search"
  | "web-fetch"
  | "memory"
  | "shell-command"
  | "delete"
  | "send-message"
  | "install-component"
  | "create-tool"
  | "unknown";

export type ProfileDecision = "allow" | "confirm";

/**
 * Profile permission matrices.
 * "confirm" means the assistant must ask. "allow" means autonomous.
 * Some actions are "always-ask" regardless of profile — handled in manager.
 */
const PROFILES: Record<SafetyProfile, Record<ActionType, ProfileDecision>> = {
  cautious: {
    "read-file": "confirm",
    "write-file-sandbox": "confirm",
    "write-file-granted": "confirm",
    "write-file-other": "confirm",
    "web-search": "confirm",
    "web-fetch": "confirm",
    memory: "allow",
    "shell-command": "confirm",
    delete: "confirm",
    "send-message": "confirm",
    "install-component": "confirm",
    "create-tool": "confirm",
    unknown: "confirm",
  },
  balanced: {
    "read-file": "allow",
    "write-file-sandbox": "allow",
    "write-file-granted": "allow",
    "write-file-other": "confirm",
    "web-search": "allow",
    "web-fetch": "allow",
    memory: "allow",
    "shell-command": "confirm",
    delete: "confirm",
    "send-message": "confirm",
    "install-component": "confirm",
    "create-tool": "confirm",
    unknown: "confirm",
  },
  autonomous: {
    "read-file": "allow",
    "write-file-sandbox": "allow",
    "write-file-granted": "allow",
    "write-file-other": "allow",
    "web-search": "allow",
    "web-fetch": "allow",
    memory: "allow",
    "shell-command": "allow",
    delete: "confirm",
    "send-message": "confirm",
    "install-component": "allow",
    "create-tool": "allow",
    unknown: "confirm",
  },
};

/** Actions that ALWAYS require confirmation regardless of profile or trust. */
export const ALWAYS_ASK: ActionType[] = ["delete", "send-message"];

export function getProfileDecision(
  profile: SafetyProfile,
  action: ActionType,
): ProfileDecision {
  return PROFILES[profile][action];
}
```

**Step 4: Rewrite PermissionManager**

Rewrite `packages/claw/src/permissions/manager.ts`:

```ts
import {
  type SafetyProfile,
  type ActionType,
  ALWAYS_ASK,
  getProfileDecision,
} from "./profiles.js";

export type PermissionDecision = "allow" | "confirm" | "deny";

export interface PermissionManagerConfig {
  profile: SafetyProfile;
  sandbox: string;
  grantedDirs: string[];
  denied?: string[];
  rules?: Record<string, ToolRule>;
  channelOverrides?: Record<string, { denied?: string[] }>;
  rateLimits?: { maxPerMinute: number; toolLimits?: Record<string, number> };
}

export interface ToolRule {
  allowPatterns?: string[];
  allowPaths?: string[];
  denyPatterns?: string[];
  denyPaths?: string[];
}

/** Maps a tool name + input to a semantic action type. */
function classifyAction(
  toolName: string,
  input: Record<string, unknown>,
  sandbox: string,
  grantedDirs: string[],
): ActionType {
  switch (toolName) {
    case "file-read":
    case "file-search":
      return "read-file";

    case "file-write": {
      const path = typeof input.path === "string" ? input.path : "";
      if (path.startsWith(sandbox)) return "write-file-sandbox";
      for (const dir of grantedDirs) {
        if (path.startsWith(dir)) return "write-file-granted";
      }
      return "write-file-other";
    }

    case "file-delete":
      return "delete";

    case "web-search":
      return "web-search";

    case "web-fetch":
      return "web-fetch";

    case "memory-search":
    case "memory-save":
      return "memory";

    case "bash":
      return "shell-command";

    case "send-message":
      return "send-message";

    case "kitn-add":
    case "kitn-registry-search":
      return "install-component";

    case "create-tool":
    case "create-agent":
      return "create-tool";

    default:
      return "unknown";
  }
}

export class PermissionManager {
  private config: PermissionManagerConfig;
  private sessionTrusted = new Set<string>();
  private runtimeGrantedDirs: string[];

  constructor(config: PermissionManagerConfig) {
    this.config = config;
    this.runtimeGrantedDirs = [...config.grantedDirs];
  }

  /**
   * Evaluate whether a tool call should be allowed, confirmed, or denied.
   * This is the main entry point for all permission checks.
   */
  evaluate(
    toolName: string,
    input: Record<string, unknown>,
    channelType?: string,
  ): PermissionDecision {
    // 1. Explicit deny list always wins
    if (this.config.denied?.includes(toolName)) return "deny";

    // 2. Channel-level overrides
    if (channelType) {
      const override = this.config.channelOverrides?.[channelType];
      if (override?.denied?.includes(toolName)) return "deny";
    }

    // 3. Advanced firewall rules (argument patterns)
    const rule = this.config.rules?.[toolName];
    if (rule) {
      const ruleResult = this.checkRule(rule, input);
      if (ruleResult === "deny") return "deny";
      if (ruleResult === "allow") return "allow";
      // "pass" means rule didn't match — fall through to profile
    }

    // 4. Classify the action semantically
    const action = classifyAction(
      toolName,
      input,
      this.config.sandbox,
      this.runtimeGrantedDirs,
    );

    // 5. Always-ask actions cannot be bypassed by trust
    if (ALWAYS_ASK.includes(action)) return "confirm";

    // 6. Session trust (non-always-ask tools)
    if (this.sessionTrusted.has(toolName)) return "allow";

    // 7. Profile-based decision
    return getProfileDecision(this.config.profile, action);
  }

  /** Grant a directory at runtime (persists in memory, caller should save to config). */
  grantDirectory(dir: string): void {
    if (!this.runtimeGrantedDirs.includes(dir)) {
      this.runtimeGrantedDirs.push(dir);
    }
  }

  /** Get all currently granted directories (for persisting to config). */
  getGrantedDirs(): string[] {
    return [...this.runtimeGrantedDirs];
  }

  trustForSession(toolName: string): void {
    this.sessionTrusted.add(toolName);
  }

  clearSessionTrust(): void {
    this.sessionTrusted.clear();
  }

  private checkRule(
    rule: ToolRule,
    input: Record<string, unknown>,
  ): "allow" | "deny" | "pass" {
    const command = typeof input.command === "string" ? input.command : null;
    const path = typeof input.path === "string" ? input.path : null;

    // Deny patterns/paths take priority
    if (rule.denyPatterns && command) {
      for (const p of rule.denyPatterns) {
        if (new RegExp(p).test(command)) return "deny";
      }
    }
    if (rule.denyPaths && path) {
      for (const prefix of rule.denyPaths) {
        if (path.startsWith(prefix)) return "deny";
      }
    }

    // Allow patterns/paths
    if (rule.allowPatterns && command) {
      for (const p of rule.allowPatterns) {
        if (new RegExp(p).test(command)) return "allow";
      }
      return "deny"; // Had allow patterns but none matched
    }
    if (rule.allowPaths && path) {
      for (const prefix of rule.allowPaths) {
        if (path.startsWith(prefix)) return "allow";
      }
      return "deny";
    }

    return "pass"; // No matching rules
  }
}
```

**Step 5: Update config schema**

Modify `packages/claw/src/config/schema.ts`:

```ts
const toolRuleSchema = z.object({
  allowPatterns: z.array(z.string()).optional(),
  allowPaths: z.array(z.string()).optional(),
  denyPatterns: z.array(z.string()).optional(),
  denyPaths: z.array(z.string()).optional(),
});

const channelOverrideSchema = z.object({
  denied: z.array(z.string()).optional(),
});

const permissionsSchema = z.object({
  profile: z.enum(["cautious", "balanced", "autonomous"]).default("balanced"),
  grantedDirs: z.array(z.string()).default([]),
  denied: z.array(z.string()).default([]),
  rules: z.record(z.string(), toolRuleSchema).default({}),
  channelOverrides: z.record(z.string(), channelOverrideSchema).default({}),
  rateLimits: z.object({
    maxPerMinute: z.number().default(30),
    toolLimits: z.record(z.string(), z.number()).default({}),
  }).optional(),
}).default({
  profile: "balanced" as const,
  grantedDirs: [],
  denied: [],
  rules: {},
  channelOverrides: {},
});
```

**Step 6: Update wrapped-tools to use `evaluate`**

Modify `packages/claw/src/agent/wrapped-tools.ts`:

```ts
export function wrapToolsWithPermissions(
  ctx: PluginContext,
  permissions: PermissionManager,
  handler: PermissionHandler,
  channelType: string = "terminal",
): Record<string, any> {
  const wrapped: Record<string, any> = {};

  for (const reg of ctx.tools.list()) {
    wrapped[reg.name] = tool({
      description: reg.description,
      inputSchema: reg.inputSchema,
      execute: async (input: any) => {
        const decision = permissions.evaluate(reg.name, input, channelType);

        if (decision === "deny") {
          return { error: `Tool "${reg.name}" is not allowed.` };
        }

        if (decision === "confirm") {
          const response = await handler.onConfirm(reg.name, input);
          if (response === "deny") {
            return { error: `Action was not approved.` };
          }
          if (response === "trust") {
            permissions.trustForSession(reg.name);
          }
          if (response === "grant-dir") {
            // Extract directory from path and grant it
            const path = typeof input.path === "string" ? input.path : "";
            const dir = path.substring(0, path.lastIndexOf("/") + 1);
            if (dir) permissions.grantDirectory(dir);
          }
        }

        return ctx.tools.execute(reg.name, input);
      },
    });
  }

  return wrapped;
}
```

**Step 7: Update agent loop to pass channelType**

Modify `packages/claw/src/agent/loop.ts`:

```ts
const wrappedTools = wrapToolsWithPermissions(ctx, permissions, permissionHandler, channelType);
```

**Step 8: Update gateway startup to construct new PermissionManager**

Modify `packages/claw/src/gateway/start.ts`:

```ts
import { CLAW_HOME } from "../config/io.js";
import { join } from "path";

const permissions = new PermissionManager({
  profile: config.permissions.profile,
  sandbox: join(CLAW_HOME, "workspace"),
  grantedDirs: config.permissions.grantedDirs,
  denied: config.permissions.denied,
  rules: config.permissions.rules,
  channelOverrides: config.permissions.channelOverrides,
  rateLimits: config.permissions.rateLimits,
});
```

**Step 9: Run all claw tests**

Run: `bun run --cwd packages/claw test`
Expected: All pass (some existing tests may need updates for new constructor)

**Step 10: Update existing integration tests**

Update `packages/claw/test/integration/gateway.test.ts` to use the new `PermissionManager` constructor with `profile`, `grantedDirs`, and `sandbox` fields.

**Step 11: Run all claw tests again**

Run: `bun run --cwd packages/claw test`
Expected: All pass

**Step 12: Commit**

```bash
git add packages/claw/src/permissions/ packages/claw/src/config/schema.ts packages/claw/src/agent/ packages/claw/src/gateway/start.ts packages/claw/test/
git commit -m "feat(claw): redesign permission system with safety profiles and directory sandbox"
```

---

## Task 2: Plain-language permission prompts

Replace technical tool-name prompts with human-readable explanations.

**Files:**
- Create: `packages/claw/src/permissions/describe.ts`
- Modify: `packages/claw/src/tui/components/PermissionPrompt.tsx`
- Test: `packages/claw/test/describe.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/describe.test.ts
import { describe, test, expect } from "bun:test";
import { describeAction } from "../src/permissions/describe.js";

describe("describeAction", () => {
  test("describes file read", () => {
    const desc = describeAction("file-read", { path: "/home/user/notes.md" });
    expect(desc.summary).toContain("read");
    expect(desc.summary).toContain("notes.md");
    expect(desc.detail).toContain("/home/user/notes.md");
  });

  test("describes file write", () => {
    const desc = describeAction("file-write", {
      path: "/home/user/Desktop/report.txt",
      content: "Hello world",
    });
    expect(desc.summary).toContain("save");
    expect(desc.summary).toContain("Desktop");
    expect(desc.icon).toBe("📄");
  });

  test("describes bash command in plain language", () => {
    const desc = describeAction("bash", { command: "ls -la /home/user" });
    expect(desc.summary).toContain("run a command");
    expect(desc.detail).toContain("ls -la");
  });

  test("describes file delete as destructive", () => {
    const desc = describeAction("file-delete", { path: "/home/user/old.txt" });
    expect(desc.summary).toContain("delete");
    expect(desc.icon).toBe("🗑️");
    expect(desc.destructive).toBe(true);
  });

  test("describes web fetch", () => {
    const desc = describeAction("web-fetch", { url: "https://example.com" });
    expect(desc.summary).toContain("visit");
    expect(desc.detail).toContain("example.com");
  });

  test("describes unknown tool generically", () => {
    const desc = describeAction("custom-tool", { foo: "bar" });
    expect(desc.summary).toContain("custom-tool");
  });

  test("provides directory grant option for file writes", () => {
    const desc = describeAction("file-write", {
      path: "/home/user/Documents/report.pdf",
    });
    expect(desc.canGrantDir).toBe(true);
    expect(desc.grantDirLabel).toContain("Documents");
  });
});
```

**Step 2: Run tests to verify failure**

**Step 3: Implement describeAction**

Create `packages/claw/src/permissions/describe.ts`:

```ts
import { basename, dirname } from "path";

export interface ActionDescription {
  summary: string;
  detail?: string;
  icon: string;
  destructive: boolean;
  canGrantDir: boolean;
  grantDirLabel?: string;
}

export function describeAction(
  toolName: string,
  input: Record<string, unknown>,
): ActionDescription {
  const path = typeof input.path === "string" ? input.path : "";
  const command = typeof input.command === "string" ? input.command : "";
  const url = typeof input.url === "string" ? input.url : "";

  switch (toolName) {
    case "file-read":
      return {
        summary: `Read the file ${basename(path)}`,
        detail: path,
        icon: "📖",
        destructive: false,
        canGrantDir: false,
      };

    case "file-write": {
      const dir = dirname(path);
      const dirName = basename(dir);
      return {
        summary: `Save a file to ${dirName}`,
        detail: path,
        icon: "📄",
        destructive: false,
        canGrantDir: true,
        grantDirLabel: `Always allow saving to ${dirName}`,
      };
    }

    case "file-delete":
      return {
        summary: `Delete the file ${basename(path)}`,
        detail: path,
        icon: "🗑️",
        destructive: true,
        canGrantDir: false,
      };

    case "file-search":
      return {
        summary: "Search for files on your computer",
        detail: typeof input.pattern === "string" ? `Pattern: ${input.pattern}` : undefined,
        icon: "🔍",
        destructive: false,
        canGrantDir: false,
      };

    case "bash":
      return {
        summary: "Run a command on your computer",
        detail: command,
        icon: "⚡",
        destructive: false,
        canGrantDir: false,
      };

    case "web-fetch":
      return {
        summary: `Visit a website`,
        detail: url ? new URL(url).hostname : undefined,
        icon: "🌐",
        destructive: false,
        canGrantDir: false,
      };

    case "web-search":
      return {
        summary: "Search the web",
        detail: typeof input.query === "string" ? input.query : undefined,
        icon: "🔎",
        destructive: false,
        canGrantDir: false,
      };

    case "send-message":
      return {
        summary: "Send a message on your behalf",
        detail: typeof input.channel === "string" ? `via ${input.channel}` : undefined,
        icon: "✉️",
        destructive: false,
        canGrantDir: false,
      };

    case "kitn-add":
      return {
        summary: "Install a new component",
        detail: typeof input.component === "string" ? input.component : undefined,
        icon: "📦",
        destructive: false,
        canGrantDir: false,
      };

    default:
      return {
        summary: `Use the tool "${toolName}"`,
        detail: JSON.stringify(input).slice(0, 100),
        icon: "🔧",
        destructive: false,
        canGrantDir: false,
      };
  }
}
```

**Step 4: Run tests, verify pass**

**Step 5: Update TUI permission prompt**

Modify `packages/claw/src/tui/components/PermissionPrompt.tsx` to use `describeAction`:

```tsx
import { describeAction } from "../../permissions/describe.js";

// In the component:
const desc = describeAction(request.toolName, request.input as Record<string, unknown>);

// Render:
// {desc.icon} {desc.summary}
//   {desc.detail}
//
//   [Allow] [Deny] {desc.canGrantDir && [desc.grantDirLabel]}
```

The handler options become:
- **Allow** → resolves with "allow"
- **Deny** → resolves with "deny"
- **Always allow [this kind of thing]** → resolves with "trust" (session) or "grant-dir" (directory)

**Step 6: Run all claw tests**

**Step 7: Commit**

```bash
git commit -m "feat(claw): add plain-language permission descriptions"
```

---

## Task 3: Safety profile selection in setup wizard

Add profile selection to the first-run setup experience.

**Files:**
- Modify: `packages/claw/src/setup.ts`

**Step 1: Add profile selection to setup wizard**

After provider/model selection, add:

```ts
const profile = await p.select({
  message: "How much should KitnClaw ask before acting?",
  options: [
    {
      value: "balanced",
      label: "Balanced (recommended)",
      hint: "Acts on its own for safe things, asks for anything risky",
    },
    {
      value: "cautious",
      label: "Cautious",
      hint: "Asks before doing almost anything — best for getting started",
    },
    {
      value: "autonomous",
      label: "Autonomous",
      hint: "Acts freely, only asks before deleting or sending messages",
    },
  ],
});

// Optional: ask for directories to grant
const grantDirs = await p.confirm({
  message: "Would you like to grant access to specific folders? (you can do this later)",
});

let grantedDirs: string[] = [];
if (grantDirs) {
  const dirs = await p.text({
    message: "Enter folder paths, separated by commas:",
    placeholder: "~/Documents, ~/Projects",
  });
  if (typeof dirs === "string") {
    grantedDirs = dirs.split(",").map((d) => d.trim().replace(/^~/, homedir()));
  }
}
```

**Step 2: Save profile and granted dirs to config**

```ts
config.permissions = {
  profile: profile as SafetyProfile,
  grantedDirs,
  denied: [],
  rules: {},
  channelOverrides: {},
};
```

**Step 3: Test manually, commit**

```bash
git commit -m "feat(claw): add safety profile selection to setup wizard"
```

---

## Task 4: Per-action governance policies

Add draft/auto/blocked modes for sensitive actions (sending messages, posting publicly, scheduling).

**Files:**
- Create: `packages/claw/src/governance/policies.ts`
- Modify: `packages/claw/src/permissions/manager.ts`
- Modify: `packages/claw/src/config/schema.ts`
- Test: `packages/claw/test/governance.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/governance.test.ts
import { describe, test, expect } from "bun:test";
import { GovernanceManager, type GovernanceConfig } from "../src/governance/policies.js";

describe("GovernanceManager", () => {
  const config: GovernanceConfig = {
    actions: {
      "send-message": "draft",
      "post-public": "draft",
      "schedule": "draft",
      "delete": "blocked",
    },
  };

  test("draft actions return 'draft' decision", () => {
    const gm = new GovernanceManager(config);
    expect(gm.evaluate("send-message")).toBe("draft");
    expect(gm.evaluate("post-public")).toBe("draft");
  });

  test("blocked actions return 'deny'", () => {
    const gm = new GovernanceManager(config);
    expect(gm.evaluate("delete")).toBe("deny");
  });

  test("unlisted actions return 'pass' (defer to permission system)", () => {
    const gm = new GovernanceManager(config);
    expect(gm.evaluate("file-read")).toBe("pass");
    expect(gm.evaluate("bash")).toBe("pass");
  });

  test("auto actions return 'allow'", () => {
    const gm = new GovernanceManager({
      actions: { "send-message": "auto" },
    });
    expect(gm.evaluate("send-message")).toBe("allow");
  });

  test("user can override defaults", () => {
    const gm = new GovernanceManager({
      actions: {
        "post-public": "auto", // user trusts posting
        "send-message": "blocked", // user blocks messaging
      },
    });
    expect(gm.evaluate("post-public")).toBe("allow");
    expect(gm.evaluate("send-message")).toBe("deny");
  });
});
```

**Step 2: Run tests to verify failure**

Run: `bun test packages/claw/test/governance.test.ts`
Expected: FAIL — module not found

**Step 3: Implement GovernanceManager**

Create `packages/claw/src/governance/policies.ts`:

```ts
export type ActionMode = "auto" | "draft" | "blocked";
export type GovernanceDecision = "allow" | "draft" | "deny" | "pass";

export interface GovernanceConfig {
  actions: Record<string, ActionMode>;
}

/** Maps tool names to governance action categories. */
const TOOL_TO_ACTION: Record<string, string> = {
  "send-message": "send-message",
  "send-email": "send-message",
  "post-tweet": "post-public",
  "post-social": "post-public",
  // scheduling is identified by the cron/schedule tools
  "schedule-job": "schedule",
  "create-cron": "schedule",
};

/** Default governance for action types not specified by user. */
const DEFAULT_GOVERNANCE: Record<string, ActionMode> = {
  "send-message": "draft",
  "post-public": "draft",
  "schedule": "draft",
};

export class GovernanceManager {
  private config: GovernanceConfig;

  constructor(config: GovernanceConfig) {
    this.config = config;
  }

  /**
   * Evaluate governance for a tool call.
   * Returns "pass" if this tool isn't governed — caller should
   * fall through to the regular permission system.
   */
  evaluate(toolName: string): GovernanceDecision {
    // Map tool name to action category
    const action = TOOL_TO_ACTION[toolName] ?? toolName;

    // Check user config first, then defaults
    const mode = this.config.actions[action]
      ?? this.config.actions[toolName]
      ?? DEFAULT_GOVERNANCE[action];

    if (!mode) return "pass"; // Not a governed action

    switch (mode) {
      case "auto": return "allow";
      case "draft": return "draft";
      case "blocked": return "deny";
    }
  }
}
```

**Step 4: Add governance config to schema**

Add to `packages/claw/src/config/schema.ts`:

```ts
const governanceSchema = z.object({
  actions: z.record(z.string(), z.enum(["auto", "draft", "blocked"])).default({
    "send-message": "draft",
    "post-public": "draft",
    "schedule": "draft",
  }),
  budgets: z.record(z.string(), z.object({
    limit: z.number(),
    period: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
  })).default({}),
}).default({
  actions: { "send-message": "draft", "post-public": "draft", "schedule": "draft" },
  budgets: {},
});

// Add to configSchema:
governance: governanceSchema,
```

**Step 5: Wire governance into PermissionManager.evaluate()**

In `packages/claw/src/permissions/manager.ts`, check governance BEFORE the profile check:

```ts
import { GovernanceManager, type GovernanceDecision } from "../governance/policies.js";

// In constructor:
private governance?: GovernanceManager;

constructor(config: PermissionManagerConfig) {
  // ...existing...
  if (config.governance) {
    this.governance = new GovernanceManager(config.governance);
  }
}

// In evaluate(), after deny list check but before profile:
if (this.governance) {
  const govDecision = this.governance.evaluate(toolName);
  if (govDecision !== "pass") return govDecision;
}
```

The `evaluate()` return type expands to `"allow" | "confirm" | "deny" | "draft"`.

**Step 6: Run tests, verify pass**

Run: `bun run --cwd packages/claw test`

**Step 7: Commit**

```bash
git add packages/claw/src/governance/ packages/claw/src/permissions/ packages/claw/src/config/schema.ts packages/claw/test/governance.test.ts
git commit -m "feat(claw): add per-action governance policies (draft/auto/blocked)"
```

---

## Task 5: Budget enforcement

Add spending caps per domain/service, enforced at the tool level. This task also introduces `packages/claw/src/governance/db.ts` — a shared governance database factory that creates the libSQL client for `~/.kitnclaw/claw.db`. Tasks 6 (drafts) and 8 (audit) reuse this same db connection.

**Files:**
- Create: `packages/claw/src/governance/db.ts` (shared governance db factory)
- Create: `packages/claw/src/governance/budget.ts`
- Modify: `packages/claw/src/agent/wrapped-tools.ts`
- Test: `packages/claw/test/budget.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/budget.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { BudgetLedger } from "../src/governance/budget.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-budget-"));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("BudgetLedger", () => {
  test("allows spending within budget", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
      },
    });
    const result = await ledger.trySpend("amazon.com", 50);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(50);
  });

  test("blocks spending over budget", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
      },
    });
    await ledger.trySpend("amazon.com", 80);
    const result = await ledger.trySpend("amazon.com", 30);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(20);
  });

  test("blocks spending on unlisted domains (default: 0)", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
      },
    });
    const result = await ledger.trySpend("ebay.com", 10);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test("allows if default budget is set", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        default: { limit: 50, period: "monthly" },
      },
    });
    const result = await ledger.trySpend("some-site.com", 25);
    expect(result.allowed).toBe(true);
  });

  test("tracks cumulative spending", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
      },
    });
    await ledger.trySpend("amazon.com", 30);
    await ledger.trySpend("amazon.com", 40);
    const result = await ledger.trySpend("amazon.com", 20);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });

  test("returns current spending summary", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
        "ebay.com": { limit: 50, period: "monthly" },
      },
    });
    await ledger.trySpend("amazon.com", 30);
    const summary = await ledger.getSummary();
    expect(summary["amazon.com"].spent).toBe(30);
    expect(summary["amazon.com"].limit).toBe(100);
    expect(summary["amazon.com"].remaining).toBe(70);
  });
});
```

**Step 2: Run tests to verify failure**

**Step 3: Create governance database factory**

Create `packages/claw/src/governance/db.ts`:

```ts
import { createClient, type Client } from "@libsql/client";
import { join } from "path";
import { CLAW_HOME } from "../config/io.js";

let _client: Client | null = null;

export interface GovernanceDbOptions {
  dbPath?: string;
  syncUrl?: string;
  authToken?: string;
}

/**
 * Get or create the shared governance database client.
 * All governance tables (budgets, drafts, audit) live in claw.db.
 * Optionally syncs to Turso cloud for multi-computer sharing.
 */
export function getGovernanceDb(options?: GovernanceDbOptions): Client {
  if (_client) return _client;
  const dbPath = options?.dbPath ?? join(CLAW_HOME, "claw.db");
  _client = createClient({
    url: `file:${dbPath}`,
    ...(options?.syncUrl ? { syncUrl: options.syncUrl, authToken: options.authToken } : {}),
  });
  return _client;
}

/** For testing: reset the singleton. */
export function resetGovernanceDb(): void {
  _client = null;
}
```

**Step 4: Implement BudgetLedger (libSQL-backed)**

Create `packages/claw/src/governance/budget.ts`:

Uses the same `@libsql/client` already used by the memory store. All governance data lives in `~/.kitnclaw/claw.db` — a single libSQL database that can optionally sync to Turso cloud for multi-computer sharing.

```ts
import { createClient, type Client } from "@libsql/client";

export interface BudgetConfig {
  limit: number;
  period: "daily" | "weekly" | "monthly";
}

interface SpendResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  currentSpend: number;
}

export class BudgetLedger {
  private db: Client;
  private budgets: Record<string, BudgetConfig>;
  private initialized = false;

  constructor(options: {
    dbPath: string;
    budgets: Record<string, BudgetConfig>;
    syncUrl?: string;
    authToken?: string;
  }) {
    this.db = createClient({
      url: `file:${options.dbPath}`,
      ...(options.syncUrl ? { syncUrl: options.syncUrl, authToken: options.authToken } : {}),
    });
    this.budgets = options.budgets;
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS budget_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_budget_domain_date ON budget_entries(domain, created_at)
    `);
    this.initialized = true;
  }

  private getPeriodStart(period: "daily" | "weekly" | "monthly"): string {
    const now = new Date();
    switch (period) {
      case "daily":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      case "weekly": {
        const day = now.getDay();
        const diff = now.getDate() - day;
        return new Date(now.getFullYear(), now.getMonth(), diff).toISOString();
      }
      case "monthly":
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    }
  }

  private async getCurrentSpend(domain: string, period: "daily" | "weekly" | "monthly"): Promise<number> {
    await this.ensureTable();
    const start = this.getPeriodStart(period);
    const result = await this.db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) as total FROM budget_entries WHERE domain = ? AND created_at >= ?",
      args: [domain, start],
    });
    return Number(result.rows[0]?.total ?? 0);
  }

  async trySpend(domain: string, amount: number, description?: string): Promise<SpendResult> {
    await this.ensureTable();

    // Look up budget: specific domain first, then "default"
    const budget = this.budgets[domain] ?? this.budgets["default"];
    if (!budget) {
      return { allowed: false, remaining: 0, limit: 0, currentSpend: 0 };
    }

    const currentSpend = await this.getCurrentSpend(domain, budget.period);
    const remaining = budget.limit - currentSpend;

    if (currentSpend + amount > budget.limit) {
      return { allowed: false, remaining, limit: budget.limit, currentSpend };
    }

    // Record the spend
    await this.db.execute({
      sql: "INSERT INTO budget_entries (domain, amount, description) VALUES (?, ?, ?)",
      args: [domain, amount, description ?? null],
    });

    return {
      allowed: true,
      remaining: remaining - amount,
      limit: budget.limit,
      currentSpend: currentSpend + amount,
    };
  }

  async getSummary(): Promise<Record<string, { spent: number; limit: number; remaining: number }>> {
    const summary: Record<string, { spent: number; limit: number; remaining: number }> = {};

    for (const [domain, budget] of Object.entries(this.budgets)) {
      if (domain === "default") continue;
      const spent = await this.getCurrentSpend(domain, budget.period);
      summary[domain] = {
        spent,
        limit: budget.limit,
        remaining: budget.limit - spent,
      };
    }

    return summary;
  }
}
```

**Step 5: Run tests, verify pass**

**Step 6: Wire budget checking into wrapped-tools**

Modify `packages/claw/src/agent/wrapped-tools.ts` — when a tool's execute function detects a spending action (e.g., `web-fetch` to a commerce site with a `purchase` flag, or a future `purchase` tool), check the budget ledger before executing:

```ts
// Budget check is optional — only applies to tools that declare spending
if (budgetLedger && input._spending) {
  const { domain, amount } = input._spending;
  const result = await budgetLedger.trySpend(domain, amount);
  if (!result.allowed) {
    return {
      error: `Budget exceeded for ${domain}. Remaining: $${result.remaining} of $${result.limit} ${budget.period} limit.`,
    };
  }
}
```

**Step 7: Run all claw tests, commit**

```bash
git commit -m "feat(claw): add budget enforcement with spending ledger"
```

---

## Task 6: Draft queue

Actions in "draft" mode produce a draft that the user must approve.

**Files:**
- Create: `packages/claw/src/governance/drafts.ts`
- Modify: `packages/claw/src/agent/wrapped-tools.ts`
- Test: `packages/claw/test/drafts.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/drafts.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createClient } from "@libsql/client";
import { DraftQueue } from "../src/governance/drafts.js";

let tmpDir: string;
let queue: DraftQueue;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-drafts-"));
  const db = createClient({ url: `file:${join(tmpDir, "claw.db")}` });
  queue = new DraftQueue(db);
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("DraftQueue", () => {
  test("creates a draft entry", async () => {
    const draft = await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: { to: "alice@example.com", body: "Hello Alice" },
      preview: "Send email to alice@example.com: Hello Alice",
      sessionId: "sess-1",
    });
    expect(draft.id).toBeDefined();
    expect(draft.status).toBe("pending");
  });

  test("lists pending drafts", async () => {
    await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: {},
      preview: "Send email",
      sessionId: "s1",
    });
    await queue.create({
      action: "post-tweet",
      toolName: "post-social",
      input: {},
      preview: "Post tweet",
      sessionId: "s1",
    });
    const pending = await queue.listPending();
    expect(pending).toHaveLength(2);
  });

  test("approves a draft", async () => {
    const draft = await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: { body: "Hello" },
      preview: "Send email",
      sessionId: "s1",
    });
    const approved = await queue.approve(draft.id);
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe("approved");
    expect(approved!.input).toEqual({ body: "Hello" });
  });

  test("rejects a draft", async () => {
    const draft = await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: {},
      preview: "Send email",
      sessionId: "s1",
    });
    await queue.reject(draft.id);
    const pending = await queue.listPending();
    expect(pending).toHaveLength(0);
  });

  test("approved drafts no longer appear in pending", async () => {
    const draft = await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: {},
      preview: "Send email",
      sessionId: "s1",
    });
    await queue.approve(draft.id);
    const pending = await queue.listPending();
    expect(pending).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify failure**

**Step 3: Implement DraftQueue (libSQL-backed)**

Create `packages/claw/src/governance/drafts.ts`:

Uses the same `claw.db` libSQL database as BudgetLedger. Shares the db connection via the governance database factory (see Task 5).

```ts
import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "crypto";

export interface DraftEntry {
  id: string;
  action: string;
  toolName: string;
  input: Record<string, unknown>;
  preview: string;
  sessionId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export class DraftQueue {
  private db: Client;
  private initialized = false;

  constructor(db: Client) {
    this.db = db;
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        preview TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status)
    `);
    this.initialized = true;
  }

  async create(params: {
    action: string;
    toolName: string;
    input: Record<string, unknown>;
    preview: string;
    sessionId: string;
  }): Promise<DraftEntry> {
    await this.ensureTable();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.db.execute({
      sql: "INSERT INTO drafts (id, action, tool_name, input, preview, session_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      args: [id, params.action, params.toolName, JSON.stringify(params.input), params.preview, params.sessionId, createdAt],
    });
    return {
      id,
      ...params,
      status: "pending",
      createdAt,
    };
  }

  async get(id: string): Promise<DraftEntry | null> {
    await this.ensureTable();
    const result = await this.db.execute({ sql: "SELECT * FROM drafts WHERE id = ?", args: [id] });
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      action: String(row.action),
      toolName: String(row.tool_name),
      input: JSON.parse(String(row.input)),
      preview: String(row.preview),
      sessionId: String(row.session_id),
      status: String(row.status) as DraftEntry["status"],
      createdAt: String(row.created_at),
    };
  }

  async listPending(): Promise<DraftEntry[]> {
    await this.ensureTable();
    const result = await this.db.execute("SELECT * FROM drafts WHERE status = 'pending' ORDER BY created_at ASC");
    return result.rows.map((row) => ({
      id: String(row.id),
      action: String(row.action),
      toolName: String(row.tool_name),
      input: JSON.parse(String(row.input)),
      preview: String(row.preview),
      sessionId: String(row.session_id),
      status: "pending" as const,
      createdAt: String(row.created_at),
    }));
  }

  async approve(id: string): Promise<DraftEntry | null> {
    await this.ensureTable();
    await this.db.execute({ sql: "UPDATE drafts SET status = 'approved' WHERE id = ?", args: [id] });
    return this.get(id);
  }

  async reject(id: string): Promise<void> {
    await this.ensureTable();
    await this.db.execute({ sql: "UPDATE drafts SET status = 'rejected' WHERE id = ?", args: [id] });
  }
}
```

**Step 4: Wire drafts into wrapped-tools**

When `evaluate()` returns `"draft"`, the wrapped tool creates a draft instead of executing:

```ts
if (decision === "draft") {
  const preview = describeAction(reg.name, input);
  await draftQueue.create({
    action: preview.summary,
    toolName: reg.name,
    input,
    preview: `${preview.icon} ${preview.summary}${preview.detail ? ` — ${preview.detail}` : ""}`,
    sessionId, // passed through from agent loop
  });
  return {
    draft: true,
    message: `This action has been saved as a draft for your review: ${preview.summary}`,
  };
}
```

**Step 5: Add `/drafts` TUI command**

Add to the TUI slash commands:
- `/drafts` — list pending drafts
- `/drafts approve <id>` — approve and execute
- `/drafts reject <id>` — discard

**Step 6: Run all tests, commit**

```bash
git commit -m "feat(claw): add draft queue for governed actions"
```

---

## Task 7: Rate limiting

Prevent runaway tool execution — max N calls per minute per tool for non-safe actions.

**Files:**
- Create: `packages/claw/src/permissions/rate-limiter.ts`
- Modify: `packages/claw/src/permissions/manager.ts`
- Test: `packages/claw/test/rate-limiter.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/rate-limiter.test.ts
import { describe, test, expect } from "bun:test";
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
    rl.tryAcquire("bash");
    rl.tryAcquire("bash");
    rl.tryAcquire("bash");
    expect(rl.tryAcquire("bash")).toBe(false);
  });

  test("separate limits per tool", () => {
    const rl = new RateLimiter({ maxPerMinute: 2 });
    rl.tryAcquire("bash");
    rl.tryAcquire("bash");
    expect(rl.tryAcquire("bash")).toBe(false);
    expect(rl.tryAcquire("file-write")).toBe(true);
  });

  test("per-tool overrides", () => {
    const rl = new RateLimiter({ maxPerMinute: 10, toolLimits: { bash: 2 } });
    rl.tryAcquire("bash");
    rl.tryAcquire("bash");
    expect(rl.tryAcquire("bash")).toBe(false);
    for (let i = 0; i < 10; i++) {
      expect(rl.tryAcquire("file-write")).toBe(true);
    }
  });

  test("resets after window expires", async () => {
    const rl = new RateLimiter({ maxPerMinute: 1, windowMs: 100 });
    expect(rl.tryAcquire("bash")).toBe(true);
    expect(rl.tryAcquire("bash")).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(rl.tryAcquire("bash")).toBe(true);
  });
});
```

**Step 2: Implement RateLimiter**

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
  private config: { maxPerMinute: number; windowMs: number; toolLimits: Record<string, number> };
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

**Step 3: Wire into PermissionManager**

Add to `packages/claw/src/permissions/manager.ts`:

```ts
import { RateLimiter } from "./rate-limiter.js";

// In constructor:
private rateLimiter?: RateLimiter;

constructor(config: PermissionManagerConfig) {
  this.config = config;
  this.runtimeGrantedDirs = [...config.grantedDirs];
  if (config.rateLimits) {
    this.rateLimiter = new RateLimiter(config.rateLimits);
  }
}

// In evaluate(), after profile decision returns "allow":
// Check rate limit for non-memory actions
if (decision === "allow" && this.rateLimiter && action !== "memory") {
  if (!this.rateLimiter.tryAcquire(toolName)) {
    return "deny";
  }
}
```

**Step 4: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): add rate limiting for tool execution"
```

---

## Task 8: Audit logging

Log all tool executions and permission decisions to the libSQL governance database.

**Files:**
- Create: `packages/claw/src/audit/logger.ts`
- Modify: `packages/claw/src/gateway/start.ts`
- Test: `packages/claw/test/audit.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/audit.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createClient } from "@libsql/client";
import { AuditLogger } from "../src/audit/logger.js";

let tmpDir: string;
let logger: AuditLogger;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-audit-"));
  const db = createClient({ url: `file:${join(tmpDir, "claw.db")}` });
  logger = new AuditLogger(db);
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("AuditLogger", () => {
  test("logs tool execution", async () => {
    await logger.log({
      event: "tool:execute",
      toolName: "bash",
      input: { command: "ls" },
      decision: "allow",
      sessionId: "s1",
      channelType: "terminal",
    });

    const entries = await logger.query({ event: "tool:execute" });
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("bash");
  });

  test("logs permission denial", async () => {
    await logger.log({
      event: "permission:denied",
      toolName: "bash",
      input: { command: "rm -rf /" },
      reason: "user_denied",
      sessionId: "s1",
      channelType: "discord",
    });

    const entries = await logger.query({ event: "permission:denied" });
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("user_denied");
  });

  test("appends multiple entries", async () => {
    await logger.log({ event: "tool:execute", toolName: "a" });
    await logger.log({ event: "tool:execute", toolName: "b" });

    const entries = await logger.query({});
    expect(entries).toHaveLength(2);
  });
});
```

**Step 2: Implement AuditLogger (libSQL-backed)**

Create `packages/claw/src/audit/logger.ts`:

Uses the shared `claw.db` database. Audit entries are structured rows, queryable by event type, tool name, session, and time range.

```ts
import type { Client } from "@libsql/client";

export interface AuditEntry {
  event: string;
  toolName?: string;
  input?: Record<string, unknown>;
  decision?: string;
  reason?: string;
  sessionId?: string;
  channelType?: string;
  duration?: number;
  [key: string]: unknown;
}

export class AuditLogger {
  private db: Client;
  private initialized = false;

  constructor(db: Client) {
    this.db = db;
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        tool_name TEXT,
        input TEXT,
        decision TEXT,
        reason TEXT,
        session_id TEXT,
        channel_type TEXT,
        duration REAL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event, created_at)
    `);
    this.initialized = true;
  }

  async log(entry: AuditEntry): Promise<void> {
    await this.ensureTable();
    const { event, toolName, input, decision, reason, sessionId, channelType, duration, ...rest } = entry;
    await this.db.execute({
      sql: `INSERT INTO audit_log (event, tool_name, input, decision, reason, session_id, channel_type, duration, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        event,
        toolName ?? null,
        input ? JSON.stringify(input) : null,
        decision ?? null,
        reason ?? null,
        sessionId ?? null,
        channelType ?? null,
        duration ?? null,
        Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
      ],
    });
  }

  async query(filters: { event?: string; toolName?: string; sessionId?: string; limit?: number }): Promise<AuditEntry[]> {
    await this.ensureTable();
    const conditions: string[] = [];
    const args: unknown[] = [];
    if (filters.event) { conditions.push("event = ?"); args.push(filters.event); }
    if (filters.toolName) { conditions.push("tool_name = ?"); args.push(filters.toolName); }
    if (filters.sessionId) { conditions.push("session_id = ?"); args.push(filters.sessionId); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit ?? 100;
    const result = await this.db.execute({ sql: `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`, args: [...args, limit] });
    return result.rows.map((row) => ({
      event: String(row.event),
      toolName: row.tool_name ? String(row.tool_name) : undefined,
      input: row.input ? JSON.parse(String(row.input)) : undefined,
      decision: row.decision ? String(row.decision) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
      sessionId: row.session_id ? String(row.session_id) : undefined,
      channelType: row.channel_type ? String(row.channel_type) : undefined,
      duration: row.duration ? Number(row.duration) : undefined,
    }));
  }
}
```

**Step 3: Wire into gateway**

Subscribe to lifecycle hooks in `packages/claw/src/gateway/start.ts`:

```ts
import { AuditLogger } from "../audit/logger.js";

// Use the shared governance db
const govDb = createClient({ url: `file:${join(CLAW_HOME, "claw.db")}` });
const auditLogger = new AuditLogger(govDb);

if (plugin.hooks) {
  plugin.hooks.on("tool:execute", (event) => {
    auditLogger.log({
      event: "tool:execute",
      toolName: event.toolName,
      input: event.input,
      duration: event.duration,
    });
  });
}
```

**Step 4: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): add libSQL-backed audit logging for tool executions"
```

---

## Task 9: Credential encryption (OS keychain with file fallback)

Store API keys in the OS keychain instead of plaintext config.

**Files:**
- Create: `packages/claw/src/config/credentials.ts`
- Modify: `packages/claw/src/config/io.ts`
- Modify: `packages/claw/src/setup.ts`
- Modify: `packages/claw/package.json`
- Test: `packages/claw/test/credentials.test.ts`

**Step 1: Write failing tests**

```ts
// packages/claw/test/credentials.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { CredentialStore } from "../src/config/credentials.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-creds-"));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("CredentialStore", () => {
  test("stores and retrieves credentials", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    await store.set("openai-key", "sk-test-123");
    expect(await store.get("openai-key")).toBe("sk-test-123");
  });

  test("deletes credentials", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    await store.set("key1", "val1");
    await store.delete("key1");
    expect(await store.get("key1")).toBeNull();
  });

  test("returns null for missing keys", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    expect(await store.get("nonexistent")).toBeNull();
  });

  test("lists stored keys", async () => {
    const store = new CredentialStore({ useKeychain: false, path: tmpDir });
    await store.set("key1", "val1");
    await store.set("key2", "val2");
    const keys = await store.list();
    expect(keys.sort()).toEqual(["key1", "key2"]);
  });
});
```

**Step 2: Implement CredentialStore**

Create `packages/claw/src/config/credentials.ts`:

```ts
import { readFile, writeFile, mkdir, rm, readdir } from "fs/promises";
import { join } from "path";

interface CredentialStoreOptions {
  useKeychain?: boolean;
  path: string;
}

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
      } catch {}
    }
    await mkdir(this.path, { recursive: true });
    await writeFile(join(this.path, key), Buffer.from(value).toString("base64"), { mode: 0o600 });
  }

  async get(key: string): Promise<string | null> {
    if (this.useKeychain) {
      try {
        const keytar = await import("keytar");
        return await keytar.getPassword(CredentialStore.SERVICE, key);
      } catch {}
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
      } catch {}
    }
    try { await rm(join(this.path, key)); } catch {}
  }

  async list(): Promise<string[]> {
    if (this.useKeychain) {
      try {
        const keytar = await import("keytar");
        const creds = await keytar.findCredentials(CredentialStore.SERVICE);
        return creds.map((c) => c.account);
      } catch {}
    }
    try { return await readdir(this.path); } catch { return []; }
  }
}
```

**Step 3: Add keytar as optional dep, add to external in tsup**

**Step 4: Wire into config loading and setup wizard**

**Step 5: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): add credential store with OS keychain support"
```

---

# Phase 2: Remote Access

Add an HTTP server to the gateway and support remote connections.

---

## Task 10: Embedded HTTP server

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
  afterEach(() => server?.stop());

  test("health endpoint returns 200", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0 });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/health`);
    expect(res.status).toBe(200);
  });

  test("rejects unauthenticated /api requests when token set", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({ port: 0, authToken: "secret" });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/status`);
    expect(res.status).toBe(401);
  });

  test("accepts authenticated requests", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      authToken: "secret",
      getStatus: () => ({ version: "0.1.0" }),
    });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/status`, {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
  });

  test("POST /api/message returns response", async () => {
    const { createHttpServer } = await import("../src/gateway/http.js");
    server = createHttpServer({
      port: 0,
      onMessage: async (sid, text) => ({ text: `Echo: ${text}`, toolCalls: [] }),
    });
    const addr = server.start();
    const res = await fetch(`http://localhost:${addr.port}/api/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", text: "Hello" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Echo: Hello");
  });
});
```

**Step 2: Implement HTTP server with Hono**

Create `packages/claw/src/gateway/http.ts` — Hono app with:
- `GET /health` — no auth
- `GET /api/status` — gateway info
- `POST /api/message` — send message, get response
- `GET /api/stream?sessionId=` — SSE stream for a session
- Auth middleware on `/api/*` routes when token is set
- WebSocket upgrade at `/ws` for remote TUI

**Step 3: Wire into gateway startup, add `authToken` to config schema**

**Step 4: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): add embedded HTTP server with auth, message API, and SSE"
```

---

## Task 11: WebSocket remote TUI + connect command

**Files:**
- Modify: `packages/claw/src/gateway/http.ts` (WebSocket handler)
- Create: `packages/claw/src/gateway/connect.ts`
- Modify: `packages/claw/src/index.ts` (add `connect` command)
- Test: `packages/claw/test/websocket.test.ts`

**Step 1: Write tests for WebSocket message exchange**

**Step 2: Add WebSocket upgrade to Bun.serve in http.ts**

**Step 3: Create connect.ts — remote TUI client that connects via WebSocket**

**Step 4: Add `kitnclaw connect <url>` command**

**Step 5: Run tests, commit.**

```bash
git commit -m "feat(claw): add WebSocket remote access and connect command"
```

---

# Phase 3: Web UI Channel

---

## Task 12: Static web chat UI

**Files:**
- Create: `packages/claw/src/web/index.html`
- Create: `packages/claw/src/web/chat.js`
- Create: `packages/claw/src/web/style.css`
- Modify: `packages/claw/src/gateway/http.ts`

**Step 1: Build a minimal web chat interface**

Single-page vanilla HTML/JS/CSS (no build step):
- Dark theme matching terminal TUI aesthetic
- Mobile-responsive layout
- Markdown rendering for assistant messages
- Tool call cards with status indicators
- Permission prompt UI with Allow/Deny/Always buttons (matches plain-language system)
- Connects to `/api/stream` via EventSource for responses
- Sends messages via `POST /api/message`
- Session management (create/switch sessions)

**Step 2: Serve static files from HTTP server**

**Step 3: Embed HTML/JS/CSS as string constants** (avoids file path issues in bundled dist)

**Step 4: Manual test — start gateway, open browser, send messages**

**Step 5: Commit**

```bash
git commit -m "feat(claw): add web chat UI channel"
```

---

# Phase 4: Multi-User Access Control

---

## Task 13: User/role system

**Files:**
- Create: `packages/claw/src/users/manager.ts`
- Modify: `packages/claw/src/config/schema.ts`
- Test: `packages/claw/test/users.test.ts`

**Step 1: Write tests** — operator/user/guest roles, channel access, tool overrides

**Step 2: Implement UserManager** — role lookup, channel access check, tool override merging

**Step 3: Update config schema** — add `users` record

**Step 4: Wire into channel manager** — check user access before routing messages

**Step 5: Run tests, commit.**

```bash
git commit -m "feat(claw): add user/role system for multi-user access"
```

---

## Task 14: Channel-level pairing

**Files:**
- Create: `packages/claw/src/users/pairing.ts`
- Test: `packages/claw/test/pairing.test.ts`

**Step 1: Write tests** — code generation, validation, expiry, single-use

**Step 2: Implement PairingManager** — generate 6-char codes, validate with TTL, single-use

**Step 3: Commit**

```bash
git commit -m "feat(claw): add pairing system for messaging channel users"
```

---

# Phase 5: Proactive Actions

---

## Task 15: Wire cron scheduler into gateway

**Files:**
- Create: `packages/claw/src/crons/setup.ts`
- Modify: `packages/claw/src/gateway/start.ts`
- Test: `packages/claw/test/crons.test.ts`

**Step 1: Write tests** — scheduler tick with no jobs, scheduler tick with due job

**Step 2: Implement setupCronScheduler** — wraps `createInternalScheduler` from @kitnai/core

**Step 3: Wire into gateway startup** — start scheduler, stop on SIGINT

**Step 4: Run tests, commit.**

```bash
git commit -m "feat(claw): wire cron scheduler into gateway"
```

---

## Task 16: HEARTBEAT.md parser

**Files:**
- Create: `packages/claw/src/crons/heartbeat.ts`
- Modify: `packages/claw/src/gateway/start.ts`
- Test: `packages/claw/test/heartbeat.test.ts`

**Step 1: Write tests** — parse morning schedule, hourly, daily, weekly, multiple sections, ignore non-schedule sections

**Step 2: Implement parseHeartbeat** — regex patterns for natural-language schedules → cron expressions

**Step 3: Wire into gateway** — load HEARTBEAT.md on startup, create cron jobs

**Step 4: Run tests, commit.**

```bash
git commit -m "feat(claw): add HEARTBEAT.md parser and cron scheduling"
```

---

## Task 17: README and security documentation

**Files:**
- Create: `packages/claw/README.md`
- Create: `packages/claw/docs/security.md`

**Step 1: Write README.md**

`packages/claw/README.md` — covers installation, quick start, setup wizard, configuration, safety profiles, and links to security docs.

Key sections:
- **What is KitnClaw?** — Personal AI assistant for daily life and work
- **Installation** — `bun install`, `kitnclaw setup`
- **Quick Start** — `kitnclaw` to launch
- **Configuration** — `~/.kitnclaw/config.toml` reference
- **Safety Profiles** — Cautious / Balanced / Autonomous explanation
- **Channels** — Terminal, Web UI, Discord, Slack, etc.
- **Remote Access** — HTTP server, WebSocket, connect command
- **Development** — building from source, running tests

**Step 2: Write security.md**

`packages/claw/docs/security.md` — comprehensive security documentation:
- **Philosophy** — designed for non-technical users, layered defense
- **Safety Profiles** — full matrix table with explanations
- **Directory Sandbox** — workspace, granted dirs, everything else
- **Per-Action Governance** — draft/auto/blocked modes, defaults, configuration
- **Budget Enforcement** — how spending caps work, tool-level enforcement, the AI cannot override
- **Draft Queue** — how drafts work, approval flow, TUI and web UI review
- **Rate Limiting** — per-tool limits, window-based
- **Audit Logging** — what's logged, where, format
- **Credential Storage** — OS keychain with file fallback
- **Multi-User Access** — roles (operator/user/guest), channel pairing
- **Progressive Trust** — session trust, directory grants, how trust builds over time
- **Advanced Firewall Rules** — for power users, per-tool argument patterns

**Step 3: Commit**

```bash
git add packages/claw/README.md packages/claw/docs/security.md
git commit -m "docs(claw): add README and security documentation"
```

---

## Task 18: Final build, typecheck, and verification

**Step 1:** `bun run typecheck` — all packages clean

**Step 2:** `bun run test` — all tests pass

**Step 3:** `bun run build` — clean build

**Step 4:** Smoke test:
- `kitnclaw setup` — verify profile selection appears
- `kitnclaw` — verify gateway starts with HTTP server
- `http://localhost:18800/health` — verify HTTP responds
- `http://localhost:18800/` — verify web UI loads
- `kitnclaw status` — verify new fields
- `kitnclaw connect ws://localhost:18800/ws` — verify remote connect

**Step 5:** Commit any fixes.

```bash
git commit -m "chore(claw): Epic 2 final verification and cleanup"
```

---

# Storage Architecture

All governance data (budgets, drafts, audit logs) is stored in a single **libSQL** database at `~/.kitnclaw/claw.db`. This choice provides:

- **Local-first** — works entirely offline, no cloud dependency
- **Turso sync** — optional cloud sync via Turso for multi-computer sharing. If configured, the same KitnClaw state (budgets, drafts, audit, memory) can be shared across machines.
- **Vector support** — libSQL supports vector embeddings, useful for future memory/RAG enhancements
- **Single file** — easy backup, migration, and debugging
- **SQL queryable** — audit logs, budget history, and drafts are all queryable with standard SQL

The memory store (`LibsqlMemoryStore`) already uses libSQL at `~/.kitnclaw/memory.db`. In this epic, we consolidate governance into `claw.db` and can optionally migrate memory into it as well (or keep separate for modularity).

**Turso cloud sync configuration** (optional):
```toml
[storage]
syncUrl = "libsql://your-db.turso.io"
authToken = "your-turso-token"
```

When `syncUrl` is set, all libSQL clients pass it through, enabling automatic local-remote sync.

---

# Implementation Order Summary

| Task | Phase | Description | Key Files |
|------|-------|-------------|-----------|
| 1 | Security | Safety profiles + directory sandbox | permissions/profiles.ts, manager.ts (REWRITE) |
| 2 | Security | Plain-language permission prompts | permissions/describe.ts (CREATE) |
| 3 | Security | Profile selection in setup wizard | setup.ts |
| 4 | Security | Per-action governance policies | governance/policies.ts (CREATE) |
| 5 | Security | Budget enforcement (libSQL) | governance/budget.ts (CREATE) |
| 6 | Security | Draft queue (libSQL) | governance/drafts.ts (CREATE) |
| 7 | Security | Rate limiting | permissions/rate-limiter.ts (CREATE) |
| 8 | Security | Audit logging (libSQL) | audit/logger.ts (CREATE) |
| 9 | Security | Credential encryption | config/credentials.ts (CREATE) |
| 10 | Remote | HTTP server + message API + SSE | gateway/http.ts (CREATE) |
| 11 | Remote | WebSocket + connect command | gateway/connect.ts (CREATE) |
| 12 | Web UI | Static web chat interface | web/index.html (CREATE) |
| 13 | Multi-User | User/role system | users/manager.ts (CREATE) |
| 14 | Multi-User | Channel pairing | users/pairing.ts (CREATE) |
| 15 | Proactive | Cron scheduler wiring | crons/setup.ts (CREATE) |
| 16 | Proactive | HEARTBEAT.md parser | crons/heartbeat.ts (CREATE) |
| 17 | Docs | README + security documentation | README.md, docs/security.md (CREATE) |
| 18 | Final | Build + typecheck + smoke test | — |
