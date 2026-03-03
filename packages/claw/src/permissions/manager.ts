import { getToolCategory } from "./categories.js";

export type PermissionDecision = "allow" | "confirm" | "deny";

export interface PermissionsConfig {
  trusted: string[];
  requireConfirmation: string[];
  denied: string[];
}

export class PermissionManager {
  private config: PermissionsConfig;
  private sessionTrusted = new Set<string>();

  constructor(config: PermissionsConfig) {
    this.config = config;
  }

  check(toolName: string): PermissionDecision {
    if (this.config.denied.includes(toolName)) return "deny";
    if (this.config.trusted.includes(toolName)) return "allow";
    if (this.sessionTrusted.has(toolName)) return "allow";
    if (this.config.requireConfirmation.includes(toolName)) return "confirm";

    const category = getToolCategory(toolName);
    switch (category) {
      case "safe":
        return "allow";
      case "moderate":
      case "dangerous":
        return "confirm";
    }
  }

  trustForSession(toolName: string): void {
    this.sessionTrusted.add(toolName);
  }

  clearSessionTrust(): void {
    this.sessionTrusted.clear();
  }
}
