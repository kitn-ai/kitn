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
    } else if (event.name === "n" || event.name === "N") {
      onDecision("deny");
    } else if (event.name === "a" || event.name === "A") {
      onDecision("trust");
    } else if (event.name === "d" || event.name === "D") {
      if (action.canGrantDir) {
        onDecision("grant-dir");
      }
    }
  });

  const borderColor = action.destructive ? "#FF4444" : "#FFAA00";

  const options = action.canGrantDir
    ? "[Y]es / [N]o / [A]lways trust / [D]irectory trust"
    : "[Y]es / [N]o / [A]lways trust this tool";

  return (
    <box
      width="100%"
      borderStyle="single"
      borderColor={borderColor}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      <text fg={borderColor}>
        {`${action.icon}  ${action.summary}`}
      </text>
      {action.detail ? (
        <text fg="#888888">
          {`   ${action.detail}`}
        </text>
      ) : null}
      {action.canGrantDir && action.grantDirLabel ? (
        <text fg="#888888">
          {`   [D] ${action.grantDirLabel}`}
        </text>
      ) : null}
      <text>
        {options}
      </text>
    </box>
  );
}
