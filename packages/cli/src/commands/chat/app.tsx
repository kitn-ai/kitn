/** @jsxImportSource react */
import React, { useState, useCallback } from "react";
import { Box, Text, Static, useApp, useInput } from "ink";
import { Select } from "@inkjs/ui";
import { useChat } from "./hooks/use-chat.js";
import { Message, type DisplayMessage } from "./components/message.js";
import { InputArea } from "./components/input-area.js";
import { Thinking } from "./components/thinking.js";
import { PlanView } from "./components/plan-view.js";
import { AskUser } from "./components/ask-user.js";
import { EnvPrompt } from "./components/env-prompt.js";
import { Stats } from "./components/stats.js";
import { isSlashCommand, handleSlashCommand, runCliCommand } from "./slash-commands.js";
import { listConversations, readConversationEvents, rebuildMessages } from "./storage.js";
import { gatherProjectContext } from "../chat-engine.js";
import type { ChatMessage, ChatPlan, AskUserItem, UpdateEnvInput, ConversationMeta } from "../chat-types.js";

export interface ChatAppProps {
  initialMessage?: string;
  serviceUrl: string;
  model?: string;
  cwd: string;
  metadata: Record<string, unknown>;
  availableComponents: string[];
  installedComponents: string[];
  conversationId: string;
  existingMessages?: ChatMessage[];
}

export function ChatApp(props: ChatAppProps) {
  const { exit } = useApp();
  const [exiting, setExiting] = useState(false);
  const [resumePicker, setResumePicker] = useState<ConversationMeta[] | null>(null);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);

  // Mutable context — updated after mutating CLI commands
  const [metadata, setMetadata] = useState(props.metadata);
  const [availableComponents, setAvailableComponents] = useState(props.availableComponents);
  const [installedComponents, setInstalledComponents] = useState(props.installedComponents);

  const {
    state,
    displayMessages,
    pendingToolCall,
    totalTokens,
    sessionStart,
    sendMessage,
    resolveToolCall,
    compactNow,
    clearMessages,
    messagesRef,
  } = useChat({ ...props, metadata, availableComponents, installedComponents });

  // Ctrl+C shows stats then exits
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      setExiting(true);
      setTimeout(() => exit(), 150);
    }
  });

  const refreshContext = useCallback(async () => {
    const ctx = await gatherProjectContext(props.cwd);
    if (ctx) {
      setMetadata(ctx.metadata);
      setAvailableComponents(ctx.availableComponents);
      setInstalledComponents(ctx.installedComponents);
    }
  }, [props.cwd]);

  const handleInput = useCallback(async (text: string) => {
    if (!isSlashCommand(text)) {
      await sendMessage(text);
      return;
    }

    const result = await handleSlashCommand(text, {
      cwd: props.cwd,
      conversationId: props.conversationId,
      compactNow,
      clearMessages,
    });

    switch (result.type) {
      case "message":
        if (result.content) {
          sendSystemMessage(result.content);
        }
        break;
      case "interactive":
        if (result.command === "resume") {
          const convos = await listConversations(props.cwd);
          if (convos.length === 0) {
            sendSystemMessage("No conversations to resume.");
          } else {
            setResumePicker(convos.slice(0, 10));
          }
        }
        break;
      case "cli": {
        const label = `kitn ${result.args.join(" ")}`;
        setRunningCommand(label);
        const { exitCode, output } = await runCliCommand(result.args, props.cwd);
        setRunningCommand(null);
        if (output) {
          sendSystemMessage(output);
        }
        if (exitCode !== 0 && !output) {
          sendSystemMessage(`Command failed (exit ${exitCode})`);
        }
        if (result.mutating && exitCode === 0) {
          await refreshContext();
        }
        break;
      }
      case "noop":
        sendSystemMessage(`Unknown command: ${text}`);
        break;
    }
  }, [sendMessage, props.cwd, props.conversationId, compactNow, clearMessages, refreshContext]);

  // Helper to push a system display message without going through the hook
  const sendSystemMessage = useCallback((content: string) => {
    // We need to trigger a re-render with a new display message
    // The simplest approach: use sendMessage's addDisplayMessage by calling it directly
    // But we don't have access. Instead, we'll use a hacky but functional approach
    // via a state setter. Let's just use the fact that Static items auto-render.
    // Actually, let's just forward to the parent via a local state approach.
    setSystemMessages((prev) => [...prev, { id: `sys-${Date.now()}`, role: "system" as const, content }]);
  }, []);

  const [systemMessages, setSystemMessages] = useState<DisplayMessage[]>([]);

  const handleResumePick = useCallback(async (id: string) => {
    setResumePicker(null);
    if (id === "__cancel__") return;

    try {
      const events = await readConversationEvents(props.cwd, id);
      const messages = rebuildMessages(events);
      // Replace current messages with resumed conversation
      messagesRef.current = messages;
      clearMessages();
      // Show last 20 messages as display
      const tail = messages.slice(-20);
      for (const msg of tail) {
        if (msg.role === "user" && msg.content) {
          sendSystemMessage(`You: ${msg.content}`);
        } else if (msg.role === "assistant" && msg.content) {
          sendSystemMessage(`kitn: ${msg.content}`);
        }
      }
      sendSystemMessage(`Resumed conversation ${id} (${messages.length} messages loaded)`);
    } catch (err: any) {
      sendSystemMessage(`Failed to resume: ${err.message}`);
    }
  }, [props.cwd, messagesRef, clearMessages]);

  const isLoading = state === "loading";
  const isIdle = state === "idle";
  const hasPending = state === "pending-tool" && pendingToolCall;

  const allDisplayMessages = [...displayMessages, ...systemMessages].sort((a, b) => {
    // Keep original order — displayMessages first, then systemMessages
    return 0;
  });

  // Merge display messages and system messages by ID order
  const mergedMessages = [...displayMessages, ...systemMessages];

  return (
    <Box flexDirection="column">
      <Static items={mergedMessages}>
        {(msg: DisplayMessage) => (
          <Message key={msg.id} message={msg} />
        )}
      </Static>

      {isLoading && <Thinking />}

      {resumePicker && (
        <Box flexDirection="column">
          <Text bold>Resume a conversation:</Text>
          <Select
            options={[
              ...resumePicker.map((c) => ({
                label: `${c.title} (${new Date(c.updatedAt).toLocaleDateString()}, ${c.messageCount} msgs)`,
                value: c.id,
              })),
              { label: "Cancel", value: "__cancel__" },
            ]}
            onChange={handleResumePick}
          />
        </Box>
      )}

      {hasPending && pendingToolCall.type === "createPlan" && (
        <PlanView
          plan={(pendingToolCall.call.input ?? {}) as ChatPlan}
          cwd={props.cwd}
          availableComponents={props.availableComponents}
          installedComponents={props.installedComponents}
          onComplete={resolveToolCall}
        />
      )}

      {hasPending && pendingToolCall.type === "askUser" && (
        <AskUser
          items={((pendingToolCall.call.input as any)?.items ?? []) as AskUserItem[]}
          onComplete={resolveToolCall}
        />
      )}

      {hasPending && pendingToolCall.type === "updateEnv" && (
        <EnvPrompt
          input={(pendingToolCall.call.input ?? {}) as UpdateEnvInput}
          onComplete={resolveToolCall}
        />
      )}

      {runningCommand && (
        <Text dimColor>Running: {runningCommand}...</Text>
      )}

      {isIdle && !exiting && !resumePicker && !runningCommand && (
        <InputArea onSubmit={handleInput} />
      )}

      {exiting && (
        <Stats
          elapsedMs={Date.now() - sessionStart}
          totalTokens={totalTokens}
        />
      )}
    </Box>
  );
}
