/** @jsxImportSource react */
import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Select, ConfirmInput, TextInput } from "@inkjs/ui";
import type { AskUserItem } from "../../chat-types.js";

interface AskUserProps {
  items: AskUserItem[];
  onComplete: (result: string) => void;
}

const CUSTOM_SENTINEL = "__custom__";

export function AskUser({ items, onComplete }: AskUserProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [responses, setResponses] = useState<string[]>([]);
  const [showCustomInput, setShowCustomInput] = useState(false);

  const finish = (allResponses: string[]) => {
    onComplete(allResponses.join("\n"));
  };

  const advance = (response?: string) => {
    const newResponses = response ? [...responses, response] : [...responses];
    setResponses(newResponses);
    setShowCustomInput(false);

    const nextIndex = currentIndex + 1;
    if (nextIndex >= items.length) {
      finish(newResponses);
    } else {
      setCurrentIndex(nextIndex);
    }
  };

  // Auto-advance for info/warning items
  useEffect(() => {
    const item = items[currentIndex];
    if (item && (item.type === "info" || item.type === "warning")) {
      // Small delay to let the text render
      const timer = setTimeout(() => advance(), 100);
      return () => clearTimeout(timer);
    }
  }, [currentIndex]);

  if (currentIndex >= items.length) return null;

  const item = items[currentIndex];

  if (item.type === "info") {
    return (
      <Box>
        <Text color="blue">{"ℹ "}</Text>
        <Text>{item.text}</Text>
      </Box>
    );
  }

  if (item.type === "warning") {
    return (
      <Box>
        <Text color="yellow">{"⚠ "}</Text>
        <Text>{item.text}</Text>
      </Box>
    );
  }

  if (item.type === "confirmation") {
    return (
      <Box>
        <Text>{item.text} (Y/n) </Text>
        <ConfirmInput
          onConfirm={() => advance("Yes")}
          onCancel={() => onComplete("User cancelled.")}
        />
      </Box>
    );
  }

  if (item.type === "option") {
    if (!item.choices?.length) {
      // No choices — auto-advance
      advance("No choices provided.");
      return null;
    }

    if (showCustomInput) {
      return (
        <Box flexDirection="column">
          <Text>{item.text}</Text>
          <Box>
            <Text>Your answer: </Text>
            <TextInput
              placeholder="Type your response..."
              onSubmit={(value) => {
                if (!value.trim()) {
                  onComplete("User cancelled.");
                } else {
                  advance(`User typed: ${value.trim()}`);
                }
              }}
            />
          </Box>
        </Box>
      );
    }

    const hasCustomOption = item.choices.some(
      (c) => /something else|type my own|other|custom/i.test(c),
    );

    const options = item.choices.map((c) => ({ label: c, value: c }));
    if (!hasCustomOption) {
      options.push({ label: "Something else (I'll type my own)", value: CUSTOM_SENTINEL });
    }

    return (
      <Box flexDirection="column">
        <Text>{item.text}</Text>
        <Select
          options={options}
          onChange={(value) => {
            if (value === CUSTOM_SENTINEL) {
              setShowCustomInput(true);
            } else {
              advance(`User selected: ${value}`);
            }
          }}
        />
      </Box>
    );
  }

  if (item.type === "question") {
    return (
      <Box flexDirection="column">
        <Text>{item.text}</Text>
        <Box>
          <Text>{"❯ "}</Text>
          <TextInput
            placeholder={item.context ?? "Type your answer..."}
            onSubmit={(value) => {
              if (!value.trim()) {
                onComplete("User cancelled.");
              } else {
                advance(`User answered: ${value.trim()}`);
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  return null;
}
