/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import { formatSessionStats } from "../../chat-engine.js";

interface StatsProps {
  elapsedMs: number;
  totalTokens: number;
}

export function Stats({ elapsedMs, totalTokens }: StatsProps) {
  return (
    <Box>
      <Text color="green" bold>Done! </Text>
      <Text dimColor>{formatSessionStats(elapsedMs, totalTokens)}</Text>
    </Box>
  );
}
