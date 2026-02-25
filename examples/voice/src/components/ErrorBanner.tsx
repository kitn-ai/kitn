import { Show } from "solid-js";

interface ErrorBannerProps {
  message: string | null;
  onDismiss: () => void;
}

export default function ErrorBanner(props: ErrorBannerProps) {
  return (
    <Show when={props.message}>
      <div class="vc-error">
        <span>{props.message}</span>
        <button onClick={props.onDismiss} class="vc-error-dismiss">
          &times;
        </button>
      </div>
    </Show>
  );
}
