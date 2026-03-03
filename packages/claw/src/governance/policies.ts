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

  evaluate(toolName: string): GovernanceDecision {
    const action = TOOL_TO_ACTION[toolName] ?? toolName;
    const mode =
      this.config.actions[action] ??
      this.config.actions[toolName] ??
      DEFAULT_GOVERNANCE[action];

    if (!mode) return "pass";

    switch (mode) {
      case "auto":
        return "allow";
      case "draft":
        return "draft";
      case "blocked":
        return "deny";
    }
  }
}
