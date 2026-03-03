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

    const action = classifyAction(
      toolName,
      input,
      this.config.sandbox,
      this.runtimeGrantedDirs,
    );

    if (ALWAYS_ASK.includes(action)) return "confirm";
    if (this.sessionTrusted.has(toolName)) return "allow";
    return getProfileDecision(this.config.profile, action);
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

    if (rule.allowPatterns && command) {
      for (const p of rule.allowPatterns) {
        if (new RegExp(p).test(command)) return "allow";
      }
      return "deny";
    }
    if (rule.allowPaths && path) {
      for (const prefix of rule.allowPaths) {
        if (path.startsWith(prefix)) return "allow";
      }
      return "deny";
    }

    return "pass";
  }
}
