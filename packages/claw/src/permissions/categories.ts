export type PermissionLevel = "safe" | "moderate" | "dangerous";

const TOOL_CATEGORIES: Record<string, PermissionLevel> = {
  "file-read": "safe",
  "file-search": "safe",
  "web-fetch": "safe",
  "web-search": "safe",
  "memory-search": "safe",
  "memory-save": "safe",
  "kitn-registry-search": "safe",
  "file-write": "moderate",
  "kitn-add": "moderate",
  "create-tool": "moderate",
  "create-agent": "moderate",
  "bash": "dangerous",
  "send-message": "dangerous",
  "file-delete": "dangerous",
};

export function getToolCategory(toolName: string): PermissionLevel {
  return TOOL_CATEGORIES[toolName] ?? "moderate";
}
