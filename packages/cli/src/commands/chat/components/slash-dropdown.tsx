/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import type { SlashCommandDef } from "../slash-commands.js";

const MAX_VISIBLE = 8;

export function filterCommands(
  commands: SlashCommandDef[],
  filter: string,
): SlashCommandDef[] {
  const lower = filter.toLowerCase();
  const filtered = lower
    ? commands.filter((c) => c.name.slice(1).toLowerCase().startsWith(lower))
    : commands;
  return filtered.slice(0, MAX_VISIBLE);
}

interface SlashDropdownProps {
  commands: SlashCommandDef[];
  filter: string;
  highlightIndex: number;
}

export function SlashDropdown({ commands, filter, highlightIndex }: SlashDropdownProps) {
  const visible = filterCommands(commands, filter);

  if (visible.length === 0) {
    return (
      <Box marginLeft={2}>
        <Text dimColor>No matching commands</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visible.map((cmd, i) => {
        const isHighlighted = i === highlightIndex;
        return (
          <Box key={cmd.name} marginLeft={2}>
            <Text color={isHighlighted ? "cyan" : undefined} bold={isHighlighted}>
              {isHighlighted ? "> " : "  "}
            </Text>
            <Text color={isHighlighted ? "cyan" : undefined} bold={isHighlighted}>
              {cmd.name.padEnd(14)}
            </Text>
            <Text dimColor>{cmd.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
