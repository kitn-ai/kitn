/** @jsxImportSource react */
import React, { useState } from "react";
import { Box, Static, useApp, useInput } from "ink";
import { useChat } from "./hooks/use-chat.js";
import { Message, type DisplayMessage } from "./components/message.js";
import { InputArea } from "./components/input-area.js";
import { Thinking } from "./components/thinking.js";
import { PlanView } from "./components/plan-view.js";
import { AskUser } from "./components/ask-user.js";
import { EnvPrompt } from "./components/env-prompt.js";
import { Stats } from "./components/stats.js";
import type { ChatPlan, AskUserItem, UpdateEnvInput } from "../chat-types.js";

export interface ChatAppProps {
  initialMessage?: string;
  serviceUrl: string;
  model?: string;
  cwd: string;
  metadata: Record<string, unknown>;
  availableComponents: string[];
  installedComponents: string[];
}

export function ChatApp(props: ChatAppProps) {
  const { exit } = useApp();
  const [exiting, setExiting] = useState(false);
  const {
    state,
    displayMessages,
    pendingToolCall,
    totalTokens,
    sessionStart,
    sendMessage,
    resolveToolCall,
  } = useChat(props);

  // Ctrl+C shows stats then exits
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      setExiting(true);
      setTimeout(() => exit(), 150);
    }
  });

  const isLoading = state === "loading";
  const isIdle = state === "idle";
  const hasPending = state === "pending-tool" && pendingToolCall;

  return (
    <Box flexDirection="column">
      <Static items={displayMessages}>
        {(msg: DisplayMessage) => (
          <Message key={msg.id} message={msg} />
        )}
      </Static>

      {isLoading && <Thinking />}

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

      {isIdle && !exiting && (
        <InputArea onSubmit={sendMessage} />
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
