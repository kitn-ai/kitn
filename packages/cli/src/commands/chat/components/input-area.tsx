/** @jsxImportSource react */
import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { TextInput } from "@inkjs/ui";
import { SlashDropdown, filterCommands } from "./slash-dropdown.js";
import type { SlashCommandDef } from "../slash-commands.js";

interface InputAreaProps {
  onSubmit: (text: string) => void;
  commands: SlashCommandDef[];
}

type InputMode = "normal" | "slash-menu";

export function InputArea({ onSubmit, commands }: InputAreaProps) {
  const [mode, setMode] = useState<InputMode>("normal");
  const [slashInput, setSlashInput] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);

  // Extract the filter part (everything after the /)
  const slashFilter = slashInput.startsWith("/") ? slashInput.slice(1).split(/\s/)[0] : "";
  const visible = filterCommands(commands, slashFilter);

  const handleNormalChange = useCallback((value: string) => {
    if (value === "/") {
      setMode("slash-menu");
      setSlashInput("/");
      setHighlightIndex(0);
    }
  }, []);

  const handleNormalSubmit = useCallback((value: string) => {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }, [onSubmit]);

  const handleSlashEnter = useCallback(() => {
    const parts = slashInput.trim().split(/\s+/);
    const cmdPart = parts[0]?.toLowerCase() ?? "";
    const trailingArgs = parts.slice(1).join(" ");

    // Exact match — submit as-is
    const exactMatch = commands.find((c) => c.name.toLowerCase() === cmdPart);
    if (exactMatch) {
      const submitText = slashInput.trim();
      setMode("normal");
      setSlashInput("");
      setHighlightIndex(0);
      onSubmit(submitText);
      return;
    }

    // Partial match — use highlighted item
    if (visible.length > 0) {
      const idx = Math.min(highlightIndex, visible.length - 1);
      const selected = visible[idx];

      if (trailingArgs) {
        // Has args: substitute command and submit
        const submitText = `${selected.name} ${trailingArgs}`;
        setMode("normal");
        setSlashInput("");
        setHighlightIndex(0);
        onSubmit(submitText);
      } else {
        // No args: fill the command, stay in menu for args
        setSlashInput(selected.name + " ");
        setHighlightIndex(0);
      }
      return;
    }

    // No match — submit anyway (handleSlashCommand will return noop)
    const submitText = slashInput.trim();
    setMode("normal");
    setSlashInput("");
    setHighlightIndex(0);
    onSubmit(submitText);
  }, [slashInput, commands, visible, highlightIndex, onSubmit]);

  // Custom key handling for slash-menu mode
  useInput((input, key) => {
    if (mode !== "slash-menu") return;

    if (key.escape) {
      setMode("normal");
      setSlashInput("");
      setHighlightIndex(0);
      return;
    }

    if (key.return) {
      handleSlashEnter();
      return;
    }

    if (key.upArrow) {
      setHighlightIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setHighlightIndex((prev) => Math.min(visible.length - 1, prev + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setSlashInput((prev) => {
        const next = prev.slice(0, -1);
        if (!next || !next.startsWith("/")) {
          setMode("normal");
          setHighlightIndex(0);
          return "";
        }
        setHighlightIndex(0);
        return next;
      });
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setSlashInput((prev) => prev + input);
      setHighlightIndex(0);
    }
  }, { isActive: mode === "slash-menu" });

  if (mode === "slash-menu") {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan" bold>{"› "}</Text>
          <Text>{slashInput}</Text>
          <Text dimColor>█</Text>
        </Box>
        <SlashDropdown
          commands={commands}
          filter={slashFilter}
          highlightIndex={highlightIndex}
        />
      </Box>
    );
  }

  return (
    <Box>
      <Text color="cyan" bold>{"› "}</Text>
      <TextInput
        placeholder="Type your message... (/ for commands)"
        onChange={handleNormalChange}
        onSubmit={handleNormalSubmit}
      />
    </Box>
  );
}
