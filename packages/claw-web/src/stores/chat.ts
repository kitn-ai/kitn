import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage } from "@/api/types";
import { generateSessionId } from "@/lib/utils";

interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ChatState {
  sessions: Session[];
  activeSessionId: string | null;
  isStreaming: boolean;

  // Actions
  createSession: () => string;
  setActiveSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateLastAssistantMessage: (
    sessionId: string,
    content: string,
    toolCalls?: ChatMessage["toolCalls"]
  ) => void;
  setStreaming: (streaming: boolean) => void;
  getActiveSession: () => Session | undefined;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      isStreaming: false,

      createSession: () => {
        const id = generateSessionId();
        const now = new Date().toISOString();
        const session: Session = {
          id,
          title: "New conversation",
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: id,
        }));
        return id;
      },

      setActiveSession: (id) => set({ activeSessionId: id }),

      deleteSession: (id) =>
        set((state) => {
          const remaining = state.sessions.filter((s) => s.id !== id);
          const activeSessionId =
            state.activeSessionId === id
              ? (remaining[0]?.id ?? null)
              : state.activeSessionId;
          return { sessions: remaining, activeSessionId };
        }),

      renameSession: (id, title) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title } : s
          ),
        })),

      addMessage: (sessionId, message) =>
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== sessionId) return s;

            const updatedAt = new Date().toISOString();
            const messages = [...s.messages, message];

            // Auto-title: after the first user message, set title to first 50 chars
            let title = s.title;
            if (
              message.role === "user" &&
              s.messages.filter((m) => m.role === "user").length === 0
            ) {
              title = message.content.slice(0, 50);
            }

            return { ...s, messages, title, updatedAt };
          }),
        })),

      updateLastAssistantMessage: (sessionId, content, toolCalls) =>
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== sessionId) return s;

            const messages = [...s.messages];
            const lastAssistantIdx = messages
              .map((m, i) => (m.role === "assistant" ? i : -1))
              .filter((i) => i !== -1)
              .at(-1);

            if (lastAssistantIdx === undefined) return s;

            messages[lastAssistantIdx] = {
              ...messages[lastAssistantIdx],
              content,
              ...(toolCalls !== undefined ? { toolCalls } : {}),
            };

            return { ...s, messages, updatedAt: new Date().toISOString() };
          }),
        })),

      setStreaming: (streaming) => set({ isStreaming: streaming }),

      getActiveSession: () => {
        const { sessions, activeSessionId } = get();
        return sessions.find((s) => s.id === activeSessionId);
      },
    }),
    {
      name: "kitn-chat",
      partialize: (state) => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    }
  )
);
