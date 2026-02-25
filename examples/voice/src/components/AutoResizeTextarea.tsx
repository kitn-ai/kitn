import { onMount, type JSX } from "solid-js";

interface AutoResizeTextareaProps {
  value: string;
  onInput: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  maxLines?: number;
  autofocus?: boolean;
  class?: string;
}

export default function AutoResizeTextarea(props: AutoResizeTextareaProps) {
  let ref!: HTMLTextAreaElement;
  const maxLines = () => props.maxLines ?? 4;

  function resize() {
    const el = ref;
    if (!el) return;
    el.style.height = "0";
    const style = getComputedStyle(el);
    const lineH = parseFloat(style.lineHeight) || 21;
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const borderY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const maxH = lineH * maxLines() + padY + borderY;
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  }

  onMount(() => {
    if (props.autofocus) {
      ref.focus();
    }
    resize();
  });

  const handleInput: JSX.EventHandler<HTMLTextAreaElement, InputEvent> = (e) => {
    props.onInput(e.currentTarget.value);
    resize();
  };

  const handleKeyDown: JSX.EventHandler<HTMLTextAreaElement, KeyboardEvent> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onSubmit?.();
    }
    if (e.key === "Escape") {
      props.onCancel?.();
    }
  };

  return (
    <textarea
      ref={ref}
      class={props.class ?? "vc-review-input"}
      value={props.value}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      placeholder={props.placeholder}
    />
  );
}
