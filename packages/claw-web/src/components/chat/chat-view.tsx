import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chat";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiClient } from "@/api/client";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { EmptyState } from "./empty-state";
import { ChatHeader } from "./chat-header";
import { cn } from "@/lib/utils";

export function ChatView() {
  const {
    activeSessionId,
    sessions,
    isStreaming,
    createSession,
    setActiveSession,
    addMessage,
    updateLastAssistantMessage,
    setStreaming,
  } = useChatStore();
  const { token } = useAuthStore();
  const isMobile = useIsMobile();
  const { sidebarOpen } = useSettingsStore();

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const abortRef = useRef<AbortController | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      let sessionId = activeSessionId;

      // Create session if none active
      if (!sessionId) {
        sessionId = createSession();
        setActiveSession(sessionId);
      }

      // Add user message
      const userMsg = {
        id: `msg-${Date.now()}-u`,
        role: "user" as const,
        content: text,
        timestamp: new Date().toISOString(),
      };
      addMessage(sessionId, userMsg);

      // Add placeholder assistant message
      const assistantMsgId = `msg-${Date.now()}-a`;
      addMessage(sessionId, {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      });

      setStreaming(true);
      abortRef.current = new AbortController();

      try {
        const response = await apiClient.sendMessage(
          sessionId,
          text,
          token ?? undefined,
        );

        if (response) {
          updateLastAssistantMessage(
            sessionId,
            response.text,
            response.toolCalls,
          );
        } else {
          updateLastAssistantMessage(
            sessionId,
            "Failed to get a response. Is KitnClaw running?",
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An error occurred";
        updateLastAssistantMessage(sessionId, `Error: ${message}`);
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      activeSessionId,
      token,
      createSession,
      setActiveSession,
      addMessage,
      updateLastAssistantMessage,
      setStreaming,
    ],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, [setStreaming]);

  const handleSuggestion = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend],
  );

  const hasMessages = activeSession && activeSession.messages.length > 0;

  return (
    <div className="flex h-full flex-col">
      <ChatHeader />

      <div className="relative flex flex-1 flex-col overflow-hidden">
        {hasMessages ? (
          <MessageList messages={activeSession.messages} isStreaming={isStreaming} />
        ) : (
          <EmptyState onSuggestion={handleSuggestion} />
        )}
      </div>

      <div
        className={cn(
          "border-t border-border bg-background px-4 pb-4 pt-3",
          isMobile ? "pb-[env(safe-area-inset-bottom,16px)]" : "",
        )}
      >
        <div className="mx-auto max-w-3xl">
          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </div>
  );
}
