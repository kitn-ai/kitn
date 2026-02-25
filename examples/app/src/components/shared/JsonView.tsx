import { Show, type Component } from "solid-js";

const JsonView: Component<{ data: unknown }> = (props) => {
  const formatted = () => {
    try {
      return JSON.stringify(props.data, null, 2);
    } catch {
      return String(props.data);
    }
  };

  return (
    <Show when={props.data != null}>
      <pre class="overflow-auto rounded-lg bg-input border border-border p-4 text-[12px] leading-relaxed text-secondary font-mono max-h-[480px] panel-scroll whitespace-pre-wrap break-all">
        {formatted()}
      </pre>
    </Show>
  );
};

export default JsonView;
