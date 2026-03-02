/** @jsxImportSource react */
import React from "react";
import { Box } from "ink";
import { Spinner } from "@inkjs/ui";

interface ThinkingProps {
  label?: string;
}

export function Thinking({ label = "Thinking..." }: ThinkingProps) {
  return (
    <Box>
      <Spinner label={label} />
    </Box>
  );
}
