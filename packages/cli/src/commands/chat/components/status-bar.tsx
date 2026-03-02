/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import { formatTokens } from "../../chat-engine.js";

interface StatusBarProps {
  projectName: string;
  model?: string;
  totalTokens: number;
}

export function StatusBar({ projectName, model, totalTokens }: StatusBarProps) {
  return (
    <Box>
      <Text color="cyan">{projectName}</Text>
      {model && (
        <Text dimColor>{" "}[{model}]</Text>
      )}
      {totalTokens > 0 && (
        <Text color="yellow">{" "}[{formatTokens(totalTokens)} tokens]</Text>
      )}
    </Box>
  );
}
