import { useKeyboard } from "@opentui/react";
import { describeAction } from "../../permissions/describe.js";

interface PermissionPromptProps {
  toolName: string;
  input: unknown;
  onDecision: (decision: "allow" | "deny" | "trust" | "grant-dir") => void;
}

export function PermissionPrompt({ toolName, input, onDecision }: PermissionPromptProps) {
  const inputRecord = (typeof input === "object" && input ? input : {}) as Record<string, unknown>;
  const action = describeAction(toolName, inputRecord);

  useKeyboard((event) => {
    if (event.name === "y" || event.name === "Y") {
      onDecision("allow");
    } else if (event.name === "n" || event.name === "N" || event.name === "escape") {
      onDecision("deny");
    } else if (event.name === "a" || event.name === "A") {
      onDecision("trust");
    } else if ((event.name === "d" || event.name === "D") && action.canGrantDir) {
      onDecision("grant-dir");
    }
  });

  const borderColor = action.destructive ? "#FF4466" : "#FFAA44";
  const iconColor = action.destructive ? "#FF4466" : "#FFAA44";

  // Build lines as a single string to avoid OpenTUI y=0 overlap bug with multiple <text> children
  const lines: string[] = [
    `${action.icon}  ${action.summary}`,
    ...(action.detail ? [`   ${action.detail}`] : []),
    ...(action.canGrantDir && action.grantDirLabel ? [`   → ${action.grantDirLabel}`] : []),
    "",
    action.canGrantDir
      ? "[Y] Allow  [N] Deny  [A] Always trust  [D] Trust directory  (Esc = deny)"
      : "[Y] Allow  [N] Deny  [A] Always trust this tool  (Esc = deny)",
  ];

  return (
    <box
      width="100%"
      height={lines.length + 2}
      borderStyle="single"
      borderColor={borderColor}
      paddingLeft={2}
      paddingRight={2}
    >
      <text fg={iconColor}>{lines.join("\n")}</text>
    </box>
  );
}
