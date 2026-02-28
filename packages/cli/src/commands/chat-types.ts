export interface PlanStep {
  action: "add" | "create" | "link" | "remove" | "unlink";
  component?: string;
  type?: string;
  name?: string;
  description?: string;
  toolName?: string;
  agentName?: string;
  reason: string;
}

export interface ChatPlan {
  summary: string;
  steps: PlanStep[];
}
