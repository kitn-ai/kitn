import {
  ChatContainerRoot,
  ChatContainerContent,
} from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageActions,
  MessageAction,
} from "@/components/ui/message";
import { DotsLoader } from "@/components/ui/loader";
import { ToolCallCard } from "./tool-call-card";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/api/types";
import { Copy, Check, Brain } from "lucide-react";
import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

export function MessageList({ messages, isStreaming }: MessageListProps) {
  return (
    <ChatContainerRoot className="flex-1">
      <ChatContainerContent className="space-y-1 px-4 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={idx === messages.length - 1}
              isStreaming={isStreaming && idx === messages.length - 1}
            />
          ))}
        </div>
      </ChatContainerContent>
      <ScrollButton className="absolute bottom-4 left-1/2 -translate-x-1/2" />
    </ChatContainerRoot>
  );
}

function MessageBubble({
  message,
  isLast,
  isStreaming,
}: {
  message: ChatMessage;
  isLast: boolean;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isEmpty = !message.content && isStreaming;

  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {isAssistant && (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Brain className="size-4" />
        </div>
      )}

      <div
        className={cn(
          "flex flex-col gap-2",
          isUser ? "max-w-[80%] items-end" : "w-full max-w-none",
        )}
      >
        {/* Tool calls (before assistant text) */}
        {isAssistant && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="w-full space-y-1.5">
            {message.toolCalls.map((tc, i) => (
              <ToolCallCard
                key={`${message.id}-tool-${i}`}
                name={tc.name}
                input={tc.input}
                result={tc.result}
              />
            ))}
          </div>
        )}

        {/* Message content */}
        {isEmpty ? (
          <div className="py-2">
            <DotsLoader size="sm" />
          </div>
        ) : message.content ? (
          isUser ? (
            <div className="rounded-2xl bg-primary/15 px-4 py-2.5 text-sm text-foreground">
              {message.content}
            </div>
          ) : (
            <MessageContent
              markdown
              className="prose prose-sm dark:prose-invert max-w-none bg-transparent p-0 text-sm"
              id={message.id}
            >
              {message.content}
            </MessageContent>
          )
        ) : null}

        {/* Actions (only on completed assistant messages) */}
        {isAssistant && message.content && !isStreaming && (
          <CopyAction content={message.content} />
        )}
      </div>
    </div>
  );
}

function CopyAction({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <MessageActions className="opacity-0 transition-opacity group-hover:opacity-100 [div:hover>&]:opacity-100">
      <MessageAction tooltip={copied ? "Copied!" : "Copy"}>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 rounded-md"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-500" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </MessageAction>
    </MessageActions>
  );
}
