/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import { PasswordInput } from "@inkjs/ui";
import type { UpdateEnvInput } from "../../chat-types.js";

interface EnvPromptProps {
  input: UpdateEnvInput;
  onComplete: (result: string) => void;
}

export function EnvPrompt({ input, onComplete }: EnvPromptProps) {
  return (
    <Box flexDirection="column">
      <Text>Enter {input.key} ({input.description}):</Text>
      <Box>
        <Text>{"❯ "}</Text>
        <PasswordInput
          placeholder="Enter value..."
          onSubmit={(value) => {
            if (!value.trim()) {
              onComplete("User cancelled.");
            } else {
              onComplete(value.trim());
            }
          }}
        />
      </Box>
    </Box>
  );
}
