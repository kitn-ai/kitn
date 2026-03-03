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
            <text>
              <b fg="#5599FF">{"You: "}</b>
              {msg.content}
            </text>
          ) : (
            <box flexDirection="column" width="100%">
              {msg.toolCalls?.map((tc, j) => (
                <ToolCard
                  key={j}
                  name={tc.name}
                  input={tc.input}
                  status="done"
                  result={tc.result}
                />
              ))}
              <markdown content={msg.content} syntaxStyle={defaultSyntaxStyle} />
            </box>
          )}
        </box>
      ))}
      {isLoading && (
        <text fg="#FFAA00">{"Thinking..."}</text>
      )}
    </scrollbox>
  );
}
