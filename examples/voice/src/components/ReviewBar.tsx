import AutoResizeTextarea from "./AutoResizeTextarea";

interface ReviewBarProps {
  text: string;
  onTextChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
}

export default function ReviewBar(props: ReviewBarProps) {
  return (
    <div class="vc-review">
      <AutoResizeTextarea
        value={props.text}
        onInput={props.onTextChange}
        onSubmit={props.onSend}
        onCancel={props.onCancel}
        placeholder="Edit transcription..."
        maxLines={4}
        autofocus
      />
      <div class="vc-review-actions">
        <button class="vc-send-btn" onClick={props.onSend} disabled={!props.text.trim()}>
          Send
        </button>
        <button class="vc-cancel-btn" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
