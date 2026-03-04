import { useState, useEffect } from "react";
import { SyntaxStyle } from "@opentui/core";
import type { ToolCallInfo } from "../../agent/loop.js";
import { ToolCard } from "./ToolCard.js";

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallInfo[];
}

interface MessagesProps {
  messages: DisplayMessage[];
  isLoading: boolean;
}

const defaultSyntaxStyle = SyntaxStyle.create();

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function ThinkingIndicator({ visible }: { visible: boolean }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <box width="100%" paddingLeft={1} marginTop={1}>
      <text fg="#FFAA44">{`${SPINNER_FRAMES[frame]} Thinking…`}</text>
    </box>
  );
}

export function Messages({ messages, isLoading }: MessagesProps) {
  return (
    <scrollbox
      width="100%"
      flexGrow={1}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      stickyScroll
      stickyStart="bottom"
    >
      {messages.map((msg, i) => (
        <box key={i} width="100%" flexDirection="column" marginBottom={1}>
          {msg.role === "user" ? (
            <box flexDirection="column" width="100%">
              <text fg="#5599FF"><b>{"▶ You"}</b></text>
              <box paddingLeft={2}>
                <text>{msg.content}</text>
              </box>
            </box>
          ) : (
            <box flexDirection="column" width="100%">
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <box flexDirection="column" width="100%" marginBottom={1}>
                  {msg.toolCalls.map((tc, j) => (
                    <ToolCard
                      key={j}
                      name={tc.name}
                      input={tc.input}
                      status="done"
                      result={tc.result}
                    />
                  ))}
                </box>
              )}
              {msg.content && (
                <markdown content={msg.content} syntaxStyle={defaultSyntaxStyle} />
              )}
            </box>
          )}
        </box>
      ))}
      <ThinkingIndicator visible={isLoading} />
    </scrollbox>
  );
}
