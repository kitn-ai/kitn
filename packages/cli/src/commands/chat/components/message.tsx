/** @jsxImportSource react */
import React from "react";
import { Box, Text } from "ink";
import pc from "picocolors";

export type MessageRole = "user" | "assistant" | "system" | "tool-result" | "plan-result" | "file-op";

export interface DisplayMessage {
  id: string;
  role: MessageRole;
  content: string;
}

const ROLE_CONFIG: Record<MessageRole, { prefix: string; color: string }> = {
  user: { prefix: "You", color: "cyan" },
  assistant: { prefix: "kitn", color: "green" },
  system: { prefix: "system", color: "yellow" },
  "tool-result": { prefix: "result", color: "" },
  "plan-result": { prefix: "plan", color: "magenta" },
  "file-op": { prefix: "file", color: "blue" },
};

const MARKDOWN_ROLES = new Set<MessageRole>(["assistant", "system"]);

function renderMarkdown(text: string): string {
  return text
    // Code blocks: ```lang\n...\n``` → dim the content, strip fences
    .replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => pc.dim(code.trimEnd()))
    // Headers
    .replace(/^####\s+(.+)$/gm, (_, h) => pc.bold(h))
    .replace(/^###\s+(.+)$/gm, (_, h) => pc.bold(pc.underline(h)))
    .replace(/^##\s+(.+)$/gm, (_, h) => pc.bold(pc.underline(h)))
    .replace(/^#\s+(.+)$/gm, (_, h) => pc.bold(pc.underline(h)))
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => pc.bold(pc.italic(t)))
    // Bold
    .replace(/\*\*(.+?)\*\*/g, (_, t) => pc.bold(t))
    // Italic
    .replace(/\*(.+?)\*/g, (_, t) => pc.italic(t))
    // Inline code
    .replace(/`([^`]+)`/g, (_, c) => pc.cyan(c))
    // Horizontal rules
    .replace(/^-{3,}$/gm, pc.dim("─".repeat(40)))
    // Unordered list bullets
    .replace(/^(\s*)\* /gm, "$1 • ")
    .replace(/^(\s*)- /gm, "$1 • ")
    // Numbered lists — keep numbers but clean up indentation
    .replace(/^(\s*)\d+\.\s/gm, (match) => match);
}

export function Message({ message }: { message: DisplayMessage }) {
  const config = ROLE_CONFIG[message.role] ?? ROLE_CONFIG.system;
  const useMarkdown = MARKDOWN_ROLES.has(message.role);
  const content = useMarkdown ? renderMarkdown(message.content) : message.content;

  return (
    <Box flexDirection="column">
      <Text bold color={config.color || undefined} dimColor={!config.color}>
        {config.prefix}
      </Text>
      <Box marginLeft={1}>
        <Text wrap="wrap">{content}</Text>
      </Box>
    </Box>
  );
}
