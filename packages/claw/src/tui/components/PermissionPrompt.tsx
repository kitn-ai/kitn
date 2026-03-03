import { useKeyboard } from "@opentui/react";

interface PermissionPromptProps {
  toolName: string;
  input: unknown;
  onDecision: (decision: "allow" | "deny" | "trust") => void;
}

export function PermissionPrompt({ toolName, input, onDecision }: PermissionPromptProps) {
  useKeyboard((event) => {
    if (event.name === "y" || event.name === "Y") {
      onDecision("allow");
    } else if (event.name === "n" || event.name === "N") {
      onDecision("deny");
    } else if (event.name === "a" || event.name === "A") {
      onDecision("trust");
    }
  });

  const inputSummary = typeof input === "object" && input
    ? JSON.stringify(input).slice(0, 80)
    : String(input);

  return (
    <box
      width="100%"
      borderStyle="single"
      borderColor="#FFAA00"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      <text fg="#FFAA00">
        {`${toolName}(${inputSummary}) requires confirmation`}
      </text>
      <text>
        {"[Y]es / [N]o / [A]lways trust this tool"}
      </text>
    </box>
  );
}
