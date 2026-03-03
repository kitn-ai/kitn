interface HeaderProps {
  model: string;
}

export function Header({ model }: HeaderProps) {
  return (
    <box
      width="100%"
      height={3}
      borderStyle="single"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
    >
      <text fg="#FF6B35"><b>KitnClaw</b></text>
      <text fg="#888888">{model}</text>
    </box>
  );
}
