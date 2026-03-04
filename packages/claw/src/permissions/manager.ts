import {
  type SafetyProfile,
  type ActionType,
  ALWAYS_ASK,
  getProfileDecision,
} from "./profiles.js";
import {
  GovernanceManager,
  type GovernanceConfig,
} from "../governance/policies.js";
import { RateLimiter } from "./rate-limiter.js";

export type PermissionDecision = "allow" | "confirm" | "deny" | "draft";

export interface PermissionManagerConfig {
  profile: SafetyProfile;
  sandbox: string;
  grantedDirs: string[];
  denied?: string[];
  rules?: Record<string, ToolRule>;
  channelOverrides?: Record<string, { denied?: string[] }>;
  rateLimits?: { maxPerMinute: number; toolLimits?: Record<string, number> };
  governance?: GovernanceConfig;
}

export interface ToolRule {
  allowPatterns?: string[];
  allowPaths?: string[];
  denyPatterns?: string[];
  denyPaths?: string[];
}

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
      const sandboxPrefix = sandbox.endsWith("/") ? sandbox : sandbox + "/";
      if (path.startsWith(sandboxPrefix) || path === sandbox)
        return "write-file-sandbox";
      for (const dir of grantedDirs) {
        const dirPrefix = dir.endsWith("/") ? dir : dir + "/";
        if (path.startsWith(dirPrefix) || path === dir)
          return "write-file-granted";
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
    case "kitn-registry-search":
      return "web-search"; // read-only, same risk as a web search
    case "kitn-add":
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
  private governance?: GovernanceManager;
  private rateLimiter?: RateLimiter;

  constructor(config: PermissionManagerConfig) {
    this.config = config;
    this.runtimeGrantedDirs = [...config.grantedDirs];
    if (config.governance) {
      this.governance = new GovernanceManager(config.governance);
    }
    if (config.rateLimits) {
      this.rateLimiter = new RateLimiter(config.rateLimits);
    }
  }

  evaluate(
    toolName: string,
    input: Record<string, unknown>,
    channelType?: string,
  ): PermissionDecision {
    if (this.config.denied?.includes(toolName)) return "deny";

    if (channelType) {
      const override = this.config.channelOverrides?.[channelType];
      if (override?.denied?.includes(toolName)) return "deny";
    }

    const rule = this.config.rules?.[toolName];
    if (rule) {
      const ruleResult = this.checkRule(rule, input);
      if (ruleResult === "deny") return "deny";
      if (ruleResult === "allow") return "allow";
    }

    if (this.governance) {
      const govDecision = this.governance.evaluate(toolName);
      if (govDecision !== "pass") return govDecision;
    }

    const action = classifyAction(
      toolName,
      input,
      this.config.sandbox,
      this.runtimeGrantedDirs,
    );

    if (ALWAYS_ASK.includes(action)) return "confirm";
    if (this.sessionTrusted.has(toolName)) return "allow";

    const decision = getProfileDecision(this.config.profile, action);
    if (decision === "allow" && this.rateLimiter && action !== "memory") {
      if (!this.rateLimiter.tryAcquire(toolName)) {
        return "deny";
      }
    }
    return decision;
  }

  grantDirectory(dir: string): void {
    if (!this.runtimeGrantedDirs.includes(dir)) {
      this.runtimeGrantedDirs.push(dir);
    }
  }

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

    // Deny checks take priority
    if (rule.denyPatterns && command) {
      for (const p of rule.denyPatterns) {
        try {
          if (new RegExp(p).test(command)) return "deny";
        } catch {}
      }
    }
    if (rule.denyPaths && path) {
      for (const prefix of rule.denyPaths) {
        if (path.startsWith(prefix)) return "deny";
      }
    }

    // Allow checks — if ANY allow constraint is set, input must match at least one
    const hasAllowConstraints = rule.allowPatterns || rule.allowPaths;
    if (hasAllowConstraints) {
      if (rule.allowPatterns && command) {
        for (const p of rule.allowPatterns) {
          try {
            if (new RegExp(p).test(command)) return "allow";
          } catch {}
        }
      }
      if (rule.allowPaths && path) {
        for (const prefix of rule.allowPaths) {
          if (path.startsWith(prefix)) return "allow";
        }
      }
      return "deny"; // Had allow constraints but nothing matched
    }

    return "pass";
  }
}
