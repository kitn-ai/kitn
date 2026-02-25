import { createSignal, For, Show, type Component } from "solid-js";
import { getJson, postSse } from "../lib/api";
import { parseSseStream } from "@kitnai/client";
import EventLog, { type LogEntry } from "./shared/EventLog.tsx";
import RequestInfo from "./shared/RequestInfo.tsx";
import StatusBadge from "./shared/StatusBadge.tsx";

interface AgentInfo {
  name: string;
  description: string;
  isOrchestrator?: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const agentStarters: Record<string, string[]> = {
  general: [
    "What's the weather in Paris?",
    "Calculate 2^10 - 1",
    "Echo: multi-turn test",
    "What's the weather in Tokyo and also calculate 100/7?",
  ],
  guarded: [
    "Hello, this is a normal message",
    "This message contains blocked keyword",
    "Tell me a joke",
  ],
};
const defaultStarters = ["Hello!", "What can you do?"];

const ChatPanel: Component = () => {
  const [agents, setAgents] = createSignal<AgentInfo[]>([]);
  const [selected, setSelected] = createSignal("general");
  const [conversationId, setConversationId] = createSignal<string | null>(null);
  const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>([]);
  const [streaming, setStreaming] = createSignal(false);
  const [currentText, setCurrentText] = createSignal("");
  const [events, setEvents] = createSignal<LogEntry[]>([]);
  const [statusText, setStatusText] = createSignal("");
  const [error, setError] = createSignal("");
  const [agentSystem, setAgentSystem] = createSignal("");

  const chatAgents = () => agents().filter((a) => !a.isOrchestrator);

  const systemPromptCache = new Map<string, string>();

  async function fetchSystemPrompt(agentName: string): Promise<string> {
    if (systemPromptCache.has(agentName)) return systemPromptCache.get(agentName)!;
    try {
      const data = await getJson<{ systemPrompt: string }>(`/api/agents/${agentName}`);
      systemPromptCache.set(agentName, data.systemPrompt);
      return data.systemPrompt;
    } catch {
      return "(could not load system prompt)";
    }
  }

  async function loadAgents() {
    try {
      const data = await getJson<{ agents: AgentInfo[] }>("/api/agents");
      setAgents(data.agents);
    } catch (e: any) {
      setError(e.message);
    }
  }

  loadAgents();
  fetchSystemPrompt(selected()).then(setAgentSystem);

  function resetChat() {
    setConversationId(null);
    setChatMessages([]);
    setEvents([]);
    setCurrentText("");
    setStatusText("");
  }

  async function send(text: string) {
    if (!selected() || !text || streaming()) return;
    setChatMessages((prev) => [...prev, { role: "user", content: text }]);
    setStreaming(true);
    setError("");
    setCurrentText("");
    setStatusText("");

    const body: Record<string, unknown> = { message: text };
    if (conversationId()) body.conversationId = conversationId();

    try {
      const res = await postSse(`/api/agents/${selected()}`, body);
      let fullText = "";

      for await (const evt of parseSseStream(res)) {
        const parsed = (() => {
          try { return JSON.parse(evt.data); }
          catch { return evt.data; }
        })();
        setEvents((prev) => [
          ...prev,
          { event: evt.event, data: parsed, timestamp: Date.now() },
        ]);
        if (evt.event === "session-start" && parsed.conversationId) {
          setConversationId(parsed.conversationId);
        }
        if (evt.event === "text-delta" && parsed.text) {
          fullText += parsed.text;
          setCurrentText(fullText);
        }
        if (evt.event === "status" && parsed.message) {
          setStatusText(parsed.message);
        }
      }

      if (fullText) {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: fullText },
        ]);
        setCurrentText("");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStreaming(false);
      setStatusText("");
    }
  }

  return (
    <div class="flex-1 flex overflow-hidden">
      {/* Left: main chat content */}
      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header bar */}
        <div class="px-6 py-4 border-b border-border-subtle flex items-center gap-3">
          <h2 class="font-display text-lg font-semibold text-heading">Chat</h2>
          <select
            class="w-full bg-input rounded-md border border-border px-3 py-2 text-sm text-primary focus:outline-none focus:border-accent/50 font-mono max-w-xs"
            value={selected()}
            onChange={(e) => {
              setSelected(e.currentTarget.value);
              resetChat();
              fetchSystemPrompt(e.currentTarget.value).then(setAgentSystem);
            }}
          >
            <For each={chatAgents()}>
              {(a) => (
                <option value={a.name}>
                  {a.name} — {a.description}
                </option>
              )}
            </For>
          </select>
          <Show when={conversationId()}>
            <span class="text-[10px] font-mono text-muted truncate max-w-[180px]">
              {conversationId()}
            </span>
          </Show>
          <button
            class="rounded-md bg-raised px-3 py-2 text-sm font-medium text-primary border border-border hover:border-accent/30 transition-colors disabled:opacity-40 ml-auto shrink-0"
            onClick={resetChat}
          >
            New Chat
          </button>
        </div>

        {/* Quick actions area */}
        <Show when={chatMessages().length === 0}>
          <div class="px-6 py-4 border-b border-border-subtle space-y-3">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Click to start a conversation
            </span>
            <div class="flex flex-wrap gap-2">
              <For each={agentStarters[selected()] ?? defaultStarters}>
                {(prompt) => (
                  <button
                    class={`rounded-md px-3 py-2 text-sm font-medium border transition-colors disabled:opacity-40 ${
                      prompt.toLowerCase().includes("blocked")
                        ? "bg-danger/10 border-danger/20 text-danger hover:bg-danger/20"
                        : "bg-raised border-border text-primary hover:border-accent/30"
                    }`}
                    onClick={() => send(prompt)}
                    disabled={streaming()}
                  >
                    {prompt}
                  </button>
                )}
              </For>
            </div>
            <Show when={selected() === "guarded"}>
              <p class="text-xs text-muted">
                The guarded agent has a guard hook that blocks any message containing the word "blocked".
                Try the red button to see the guard reject the request.
              </p>
            </Show>
          </div>
        </Show>

        {/* Follow-up prompts */}
        <Show when={chatMessages().length > 0 && !streaming()}>
          <div class="px-6 py-3 border-b border-border-subtle flex flex-wrap gap-2">
            <button
              class="rounded-md bg-raised px-3 py-2 text-sm font-medium text-primary border border-border hover:border-accent/30 transition-colors disabled:opacity-40"
              onClick={() => send("Tell me more about that")}
            >
              Tell me more
            </button>
            <button
              class="rounded-md bg-raised px-3 py-2 text-sm font-medium text-primary border border-border hover:border-accent/30 transition-colors disabled:opacity-40"
              onClick={() => send("Can you also check the weather in Berlin?")}
            >
              Also check Berlin weather
            </button>
            <button
              class="rounded-md bg-raised px-3 py-2 text-sm font-medium text-primary border border-border hover:border-accent/30 transition-colors disabled:opacity-40"
              onClick={() => send("Now calculate 2^16")}
            >
              Calculate 2^16
            </button>
          </div>
        </Show>

        {/* Request info (collapsible) */}
        <Show when={agentSystem()}>
          <div class="px-6 py-3 border-b border-border-subtle">
            <RequestInfo
              agent={selected()}
              system={agentSystem()}
            />
          </div>
        </Show>

        {/* Scrollable message area */}
        <div class="flex-1 overflow-auto panel-scroll p-4 space-y-3">
          <For each={chatMessages()}>
            {(msg) => (
              <div
                class={`rounded-lg px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-accent/8 border border-accent/15 ml-12"
                    : "bg-surface border border-border mr-12"
                }`}
              >
                <span class="text-[10px] font-semibold uppercase tracking-widest text-muted block mb-1">{msg.role}</span>
                <p class="whitespace-pre-wrap text-primary">{msg.content}</p>
              </div>
            )}
          </For>

          <Show when={currentText()}>
            <div class="bg-surface border border-border rounded-lg px-4 py-3 text-sm mr-12 animate-pulse">
              <span class="text-[10px] font-semibold uppercase tracking-widest text-muted block mb-1">assistant</span>
              <p class="whitespace-pre-wrap text-primary">{currentText()}</p>
            </div>
          </Show>

          <Show when={statusText()}>
            <div class="flex items-center gap-2 text-xs text-muted">
              <StatusBadge event="status" />
              {statusText()}
            </div>
          </Show>
        </div>

        {error() && <p class="px-6 py-2 text-sm text-danger">{error()}</p>}
      </div>

      {/* Right: event log sidebar */}
      <div class="w-[480px] shrink-0 flex flex-col border-l border-border bg-surface/50">
        <div class="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
          <span class="text-xs font-medium text-secondary">Event Log</span>
          <span class="text-[10px] font-mono text-muted">{events().length}</span>
        </div>
        <EventLog entries={events()} />
      </div>
    </div>
  );
};

export default ChatPanel;
