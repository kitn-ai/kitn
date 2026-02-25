import type { Component } from "solid-js";

const EVENT_STYLES: Record<string, string> = {
  "session:start": "bg-muted/20 text-muted",
  "text-delta": "bg-success/12 text-success",
  "tool-call": "bg-info/12 text-info",
  "tool-result": "bg-cyan/12 text-cyan",
  "agent:start": "bg-purple/12 text-purple",
  "agent:end": "bg-purple/12 text-purple",
  "agent:think": "bg-accent/12 text-accent",
  "agent:plan": "bg-warning/12 text-warning",
  "delegate:start": "bg-accent-dim/15 text-accent-dim",
  "delegate:end": "bg-accent-dim/15 text-accent-dim",
  status: "bg-warning/10 text-warning",
  "skill:inject": "bg-pink/12 text-pink",
  "ask:user": "bg-orange/12 text-orange",
  done: "bg-muted/20 text-muted",
  error: "bg-danger/15 text-danger",
  cancelled: "bg-danger/15 text-danger",
};

const StatusBadge: Component<{ event: string }> = (props) => {
  const style = () => EVENT_STYLES[props.event] ?? "bg-muted/20 text-muted";

  return (
    <span
      class={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium font-mono leading-none ${style()}`}
    >
      {props.event}
    </span>
  );
};

export default StatusBadge;
