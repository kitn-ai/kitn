export interface PlanStep {
  action: "add" | "create" | "link" | "remove" | "unlink" | "registry-add";
  component?: string;
  type?: string;
  name?: string;
  description?: string;
  toolName?: string;
  agentName?: string;
  namespace?: string;
  url?: string;
  reason: string;
}

export interface ChatPlan {
  summary: string;
  steps: PlanStep[];
}
