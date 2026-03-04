import { useState, useEffect, useRef, useCallback } from "react";

// Override textarea default (Enter = newline) so Enter submits and Shift+Enter adds a newline
const SUBMIT_BINDINGS = [
  { name: "return", action: "submit" },
  { name: "linefeed", action: "submit" },
  { name: "return", shift: true, action: "newline" },
];

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (text: string) => void;
  disabled: boolean;
  focused?: boolean;
  placeholder?: string;
  /** Increment to force textarea to remount with current value (for clear/history nav) */
  syncCount?: number;
}

export function InputBar({ value, onChange, onSubmit, disabled, focused = true, placeholder, syncCount = 0 }: InputBarProps) {
  const [inputKey, setInputKey] = useState(0);
  const [initialValue, setInitialValue] = useState(value);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textareaRef = useRef<any>(null);

  // When syncCount changes, remount textarea with the current value
  useEffect(() => {
    setInitialValue(value);
    setInputKey((k) => k + 1);
    // Intentionally only depends on syncCount — value is read at trigger time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncCount]);

  const handleContentChange = useCallback(() => {
    // ContentChangeEvent is empty; read plainText from the renderable instance
    const text: string = textareaRef.current?.plainText ?? "";
    onChange(text);
  }, [onChange]);

  const handleSubmit = useCallback(() => {
    const text: string = textareaRef.current?.plainText ?? "";
    if (text.trim()) {
      onSubmit?.(text);
    }
  }, [onSubmit]);

  // Grow 1–4 content lines based on explicit newlines (Shift+Enter adds lines)
  const lineCount = Math.max(1, value.split("\n").length);
  const contentLines = Math.min(4, lineCount);
  const boxHeight = contentLines + 2; // +2 for borders

  return (
    <box
      width="100%"
      height={boxHeight}
      borderStyle="single"
      borderColor={disabled ? "#444444" : "#5599FF"}
      paddingLeft={1}
      paddingRight={1}
    >
      <textarea
        key={inputKey}
        ref={textareaRef}
        focused={focused && !disabled}
        flexGrow={1}
        height={contentLines}
        initialValue={initialValue}
        placeholder={placeholder ?? "Message KitnClaw   /  commands   Shift+↵ newline"}
        onContentChange={handleContentChange}
        onSubmit={handleSubmit}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        keyBindings={SUBMIT_BINDINGS as any}
        wrapMode="word"
      />
    </box>
  );
}
