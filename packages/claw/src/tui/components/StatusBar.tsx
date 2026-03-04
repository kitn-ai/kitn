interface StatusBarProps {
  isLoading?: boolean;
}

export function StatusBar({ isLoading }: StatusBarProps) {
  const hints = isLoading
    ? " ⟳ Processing…"
    : " ↵ send   ⇧↵ newline   / commands   Ctrl+Q exit";

  return (
    <box width="100%" height={1} paddingLeft={1} paddingRight={1}>
      <text fg="#444444">{hints}</text>
    </box>
  );
}
