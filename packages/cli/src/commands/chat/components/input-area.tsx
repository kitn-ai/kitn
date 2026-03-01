/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import { TextInput } from "@inkjs/ui";

interface InputAreaProps {
  onSubmit: (text: string) => void;
}

export function InputArea({ onSubmit }: InputAreaProps) {
  return (
    <Box>
      <Text color="cyan" bold>{"❯ "}</Text>
      <TextInput
        placeholder="Type your message..."
        onSubmit={(value) => {
          const trimmed = value.trim();
          if (trimmed) onSubmit(trimmed);
        }}
      />
    </Box>
  );
}
