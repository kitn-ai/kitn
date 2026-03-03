interface ToolCardProps {
  name: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: unknown;
}

export function ToolCard({ name, input, status }: ToolCardProps) {
  const statusColors: Record<string, string> = {
    running: "#FFAA00",
    done: "#00CC66",
    error: "#FF4444",
  };

  const statusIcons: Record<string, string> = {
    running: "...",
    done: "ok",
    error: "err",
  };

  const inputSummary = Object.entries(input)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");

  const display = inputSummary.length > 60
    ? inputSummary.slice(0, 60) + "..."
    : inputSummary;

  return (
    <box width="100%" paddingLeft={2} flexDirection="column">
      <text fg={statusColors[status]}>
        {`[${statusIcons[status]}] ${name}(${display})`}
      </text>
    </box>
  );
}
