import { For, Show, type Component } from "solid-js";
import StatusBadge from "./StatusBadge.tsx";

export interface LogEntry {
  event: string;
  data: unknown;
  timestamp: number;
}

function getEventSummary(event: string, data: any): string {
  if (!data || typeof data !== "object") return String(data ?? "");
  switch (event) {
    case "text-delta":
      return data.text ?? "";
    case "tool-call": {
      const name = data.toolName ?? data.tool ?? "?";
      const args = JSON.stringify(data.args ?? {});
      return `${name}(${args.length > 60 ? args.slice(0, 60) + "\u2026" : args})`;
    }
    case "tool-result": {
      const name = data.toolName ?? data.tool ?? "?";
      const result = JSON.stringify(data.result ?? {});
      return `${name} \u2192 ${result.length > 80 ? result.slice(0, 80) + "\u2026" : result}`;
    }
    case "agent:start":
      return `${data.agent} started`;
    case "agent:end":
      return data.error
        ? `${data.agent} failed: ${data.error}`
        : `${data.agent} completed`;
    case "delegate:start":
      return `${data.from} \u2192 ${data.to}: "${(data.query ?? "").slice(0, 50)}"`;
    case "delegate:end": {
      const summary = data.summary ?? "";
      return `${data.to} finished${summary ? `: "${summary.slice(0, 60)}"` : ""}`;
    }
    case "status":
      return `[${data.code}] ${data.message ?? ""}`;
    case "session:start":
      return data.conversationId ?? "";
    case "done":
      return "stream complete";
    case "error":
      return data.error ?? "unknown error";
    case "cancelled":
      return "cancelled";
    default:
      return JSON.stringify(data).slice(0, 100);
  }
}

const EventLog: Component<{ entries: LogEntry[] }> = (props) => {
  return (
    <div class="flex-1 overflow-auto panel-scroll">
      <For each={props.entries}>
        {(entry) => {
          const d = entry.data as any;
          const summary = getEventSummary(entry.event, d);
          const agent = d?.agent;
          const isTextDelta = entry.event === "text-delta";
          const fullJson =
            typeof entry.data === "string"
              ? entry.data
              : JSON.stringify(entry.data, null, 2);

          return (
            <div class="border-b border-border-subtle px-3 py-2 hover:bg-raised/30 transition-colors text-[11px]">
              {/* Header row */}
              <div class="flex items-center gap-1.5">
                <StatusBadge event={entry.event} />
                <Show when={agent && !isTextDelta}>
                  <span class="text-accent/60 font-mono text-[10px]">
                    {agent}
                  </span>
                </Show>
                <span class="flex-1 min-w-0 truncate text-secondary font-mono">
                  {summary}
                </span>
                <span class="shrink-0 text-[10px] text-muted font-mono tabular-nums">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* Expandable full data */}
              <Show when={!isTextDelta}>
                <details class="mt-1.5">
                  <summary class="text-[10px] text-muted cursor-pointer hover:text-secondary select-none">
                    raw data
                  </summary>
                  <pre class="mt-1 text-[10px] leading-relaxed text-secondary/70 whitespace-pre-wrap break-all bg-input/50 rounded px-2 py-1.5">
                    {fullJson}
                  </pre>
                </details>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
};

export default EventLog;
