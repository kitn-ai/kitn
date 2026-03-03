import { useState } from "react";

interface InputBarProps {
  onSubmit: (text: string) => void;
  disabled: boolean;
}

export function InputBar({ onSubmit, disabled }: InputBarProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <box
      width="100%"
      borderStyle="single"
      borderColor={disabled ? "#555555" : "#5599FF"}
      paddingLeft={1}
      paddingRight={1}
    >
      <input
        focused={!disabled}
        width="100%"
        placeholder={disabled ? "Waiting for response..." : "Type a message..."}
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit as any}
      />
    </box>
  );
}
