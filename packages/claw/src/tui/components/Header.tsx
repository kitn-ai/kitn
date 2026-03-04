interface HeaderProps {
  model: string;
  sessionCount?: number;
}

export function Header({ model }: HeaderProps) {
  // Shorten long model names for display
  const displayModel = model.length > 32 ? model.slice(0, 31) + "…" : model;

  return (
    <box
      width="100%"
      height={3}
      borderStyle="single"
      borderColor="#333333"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
    >
      <text>
        <b fg="#5599FF">{"◆ KitnClaw"}</b>
      </text>
      <text fg="#555555">{displayModel}</text>
    </box>
  );
}
