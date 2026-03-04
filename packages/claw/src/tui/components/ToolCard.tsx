interface ToolCardProps {
  name: string;
  input: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: unknown;
}

export function ToolCard({ name, input, status }: ToolCardProps) {
  const icon = status === "running" ? "⟳" : status === "done" ? "✓" : "✗";
  const color = status === "running" ? "#FFAA44" : status === "done" ? "#22CC77" : "#FF4466";

  // Build a compact args summary
  const entries = Object.entries(input);
  let argsSummary = "";
  if (entries.length === 1) {
    const [, v] = entries[0];
    const str = typeof v === "string" ? v : JSON.stringify(v);
    argsSummary = str.length > 50 ? str.slice(0, 49) + "…" : str;
  } else if (entries.length > 1) {
    const parts = entries.map(([k, v]) => {
      const str = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${str.length > 20 ? str.slice(0, 19) + "…" : str}`;
    });
    const joined = parts.join("  ");
    argsSummary = joined.length > 60 ? joined.slice(0, 59) + "…" : joined;
  }

  const line = argsSummary ? `${name}  ${argsSummary}` : name;

  return (
    <box width="100%" paddingLeft={2}>
      <text fg={color}>{`${icon} ${line}`}</text>
    </box>
  );
}
