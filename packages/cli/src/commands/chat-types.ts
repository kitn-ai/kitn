// --- Tool call protocol types ---

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  toolCallId: string;
  result: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

// --- Plan types ---

export interface PlanStep {
  action: "add" | "create" | "link" | "remove" | "unlink" | "registry-add" | "update";
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

// --- Service response type ---

export interface ChatServiceResponse {
  message: {
    role: "assistant";
    content: string;
    toolCalls?: ToolCall[];
  };
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

// --- askUser item types (mirrors kitn core _clarify tool) ---

export interface AskUserItem {
  type: "question" | "option" | "confirmation" | "info" | "warning";
  text: string;
  choices?: string[];
  context?: string;
}

// --- updateEnv input type ---

export interface UpdateEnvInput {
  key: string;
  description: string;
}

// --- writeFile input type ---

export interface WriteFileInput {
  path: string;
  content: string;
  description?: string;
}

// --- readFile input type ---

export interface ReadFileInput {
  path: string;
}

// --- listFiles input type ---

export interface ListFilesInput {
  pattern: string;
  directory?: string;
}
