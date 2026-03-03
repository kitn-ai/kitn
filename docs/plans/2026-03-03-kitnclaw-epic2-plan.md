# KitnClaw Epic 2: Security, Remote Access, Web UI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden KitnClaw with a user-friendly permission system (safety profiles, plain-language prompts, directory sandboxing), audit logging, credential encryption, remote access via WebSocket, a web chat UI, multi-user access control, and proactive scheduled actions.

**Architecture:** Build on Epic 1's foundation. The permission system is redesigned around two layers: (1) safety profiles with plain-language prompts for end users, and (2) config-level firewall rules for advanced users. A directory sandbox model gives the assistant free access to its workspace and user-granted directories, requiring permission for everything else. Remote access uses a Hono HTTP server embedded in the gateway. Web UI is a new channel backed by SSE. Multi-user adds user/role system with pairing. Proactive actions wire @kitnai/core's existing cron infrastructure.

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

## Task 4: Rate limiting

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

## Task 5: Audit logging

Log all tool executions and permission decisions to `~/.kitnclaw/logs/audit.jsonl`.

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
  test("logs tool execution", async () => {
    const logger = new AuditLogger(join(tmpDir, "audit.jsonl"));
    await logger.log({
      event: "tool:execute",
      toolName: "bash",
      input: { command: "ls" },
      decision: "allow",
      sessionId: "s1",
      channelType: "terminal",
      timestamp: Date.now(),
    });

    const content = await readFile(join(tmpDir, "audit.jsonl"), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.event).toBe("tool:execute");
    expect(entry.toolName).toBe("bash");
  });

  test("logs permission denial", async () => {
    const logger = new AuditLogger(join(tmpDir, "audit.jsonl"));
    await logger.log({
      event: "permission:denied",
      toolName: "bash",
      input: { command: "rm -rf /" },
      reason: "user_denied",
      sessionId: "s1",
      channelType: "discord",
      timestamp: Date.now(),
    });

    const content = await readFile(join(tmpDir, "audit.jsonl"), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.event).toBe("permission:denied");
    expect(entry.reason).toBe("user_denied");
  });

  test("appends multiple entries", async () => {
    const logger = new AuditLogger(join(tmpDir, "audit.jsonl"));
    await logger.log({ event: "tool:execute", toolName: "a", timestamp: 1 });
    await logger.log({ event: "tool:execute", toolName: "b", timestamp: 2 });

    const lines = (await readFile(join(tmpDir, "audit.jsonl"), "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});
```

**Step 2: Implement AuditLogger**

Create `packages/claw/src/audit/logger.ts`:

```ts
import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";

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

  async log(entry: Record<string, unknown>): Promise<void> {
    await this.ensureDir();
    await appendFile(this.path, JSON.stringify(entry) + "\n");
  }
}
```

**Step 3: Wire into gateway**

Subscribe to lifecycle hooks in `packages/claw/src/gateway/start.ts`:

```ts
import { AuditLogger } from "../audit/logger.js";

const auditLogger = new AuditLogger(join(CLAW_HOME, "logs", "audit.jsonl"));

if (plugin.hooks) {
  plugin.hooks.on("tool:execute", (event) => {
    auditLogger.log({
      event: "tool:execute",
      toolName: event.toolName,
      input: event.input,
      duration: event.duration,
      timestamp: event.timestamp,
    });
  });
}
```

**Step 4: Run tests, verify pass. Commit.**

```bash
git commit -m "feat(claw): add JSONL audit logging for tool executions"
```

---

## Task 6: Credential encryption (OS keychain with file fallback)

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

## Task 7: Embedded HTTP server

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

## Task 8: WebSocket remote TUI + connect command

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

## Task 9: Static web chat UI

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

## Task 10: User/role system

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

## Task 11: Channel-level pairing

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

## Task 12: Wire cron scheduler into gateway

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

## Task 13: HEARTBEAT.md parser

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

## Task 14: Final build, typecheck, and verification

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

# Implementation Order Summary

| Task | Phase | Description | Key Files |
|------|-------|-------------|-----------|
| 1 | Security | Safety profiles + directory sandbox | permissions/profiles.ts, manager.ts (REWRITE) |
| 2 | Security | Plain-language permission prompts | permissions/describe.ts (CREATE) |
| 3 | Security | Profile selection in setup wizard | setup.ts |
| 4 | Security | Rate limiting | permissions/rate-limiter.ts (CREATE) |
| 5 | Security | Audit logging | audit/logger.ts (CREATE) |
| 6 | Security | Credential encryption | config/credentials.ts (CREATE) |
| 7 | Remote | HTTP server + message API + SSE | gateway/http.ts (CREATE) |
| 8 | Remote | WebSocket + connect command | gateway/connect.ts (CREATE) |
| 9 | Web UI | Static web chat interface | web/index.html (CREATE) |
| 10 | Multi-User | User/role system | users/manager.ts (CREATE) |
| 11 | Multi-User | Channel pairing | users/pairing.ts (CREATE) |
| 12 | Proactive | Cron scheduler wiring | crons/setup.ts (CREATE) |
| 13 | Proactive | HEARTBEAT.md parser | crons/heartbeat.ts (CREATE) |
| 14 | Final | Build + typecheck + smoke test | — |
