import { Show, type Component } from "solid-js";

interface Props {
  system?: string;
  prompt?: string;
  agent?: string;
  format?: string;
  tools?: string[];
}

const RequestInfo: Component<Props> = (props) => {
  return (
    <div class="rounded-lg border border-border bg-surface p-4 space-y-3 text-sm">
      <Show when={props.agent}>
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Agent
          </span>
          <span class="text-accent font-mono text-xs">{props.agent}</span>
          <Show when={props.format}>
            <span class="text-[10px] text-muted font-mono">({props.format})</span>
          </Show>
        </div>
      </Show>
      <Show when={props.tools?.length}>
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Tools
          </span>
          <span class="text-purple font-mono text-xs">{props.tools!.join(", ")}</span>
        </div>
      </Show>
      <Show when={props.system}>
        <details>
          <summary class="text-[10px] font-semibold uppercase tracking-widest text-muted cursor-pointer hover:text-secondary select-none">
            System Prompt
          </summary>
          <pre class="mt-2 bg-input rounded-md px-3 py-2 text-[11px] leading-relaxed text-secondary font-mono whitespace-pre-wrap max-h-48 overflow-auto panel-scroll">
            {props.system}
          </pre>
        </details>
      </Show>
      <Show when={props.prompt}>
        <details>
          <summary class="text-[10px] font-semibold uppercase tracking-widest text-muted cursor-pointer hover:text-secondary select-none">
            User Prompt
          </summary>
          <pre class="mt-2 bg-info/5 border border-info/10 rounded-md px-3 py-2 text-[11px] leading-relaxed text-info/80 font-mono whitespace-pre-wrap max-h-32 overflow-auto panel-scroll">
            {props.prompt}
          </pre>
        </details>
      </Show>
    </div>
  );
};

export default RequestInfo;
