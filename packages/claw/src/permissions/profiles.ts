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

export const ALWAYS_ASK: ActionType[] = ["delete", "send-message"];

export function getProfileDecision(
  profile: SafetyProfile,
  action: ActionType,
): ProfileDecision {
  return PROFILES[profile][action];
}
