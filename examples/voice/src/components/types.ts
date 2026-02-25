export type Status = "idle" | "recording" | "transcribing" | "reviewing" | "streaming" | "speaking";

export interface ActivityEvent {
  type:
    | "agent-start"
    | "agent-end"
    | "delegate-start"
    | "delegate-end"
    | "tool-call"
    | "tool-result"
    | "agent-think"
    | "agent-plan";
  label: string;
  detail?: string;
}

export interface Exchange {
  id: number;
  userText: string;
  agentText: string;
  activityLog: ActivityEvent[];
  isComplete: boolean;
  usage?: { totalTokens?: number };
  timestamp: Date;
  audioId?: string;
}
