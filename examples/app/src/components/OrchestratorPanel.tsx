import { createSignal, For, Show, type Component } from "solid-js";
import { getJson, postSse } from "../lib/api";
import { parseSseStream } from "@kitnai/client";
import EventLog, { type LogEntry } from "./shared/EventLog.tsx";
import RequestInfo from "./shared/RequestInfo.tsx";
import StatusBadge from "./shared/StatusBadge.tsx";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PlanTask {
  agent: string;
  query: string;
  skills?: string[];
}

interface QuickTest {
  label: string;
  message: string;
  planMode?: boolean;
  autonomous?: boolean;
}

const quickTests: QuickTest[] = [
  {
    label: "Simple route (autonomous)",
    message: "What's the weather in Tokyo?",
    autonomous: true,
  },
  {
    label: "Multi-agent (autonomous)",
    message: "Check the weather in London AND calculate 2^20",
    autonomous: true,
  },
  {
    label: "Plan mode (needs approval)",
    message: "Get weather for Paris, New York, and Sydney, then calculate the average of their temperatures",
    planMode: true,
    autonomous: false,
  },
  {
    label: "Non-autonomous (shows plan)",
    message: "Echo 'hello' and check weather in Berlin",
    autonomous: false,
  },
];

const OrchestratorPanel: Component = () => {
  const [conversationId, setConversationId] = createSignal<string | null>(null);
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [currentText, setCurrentText] = createSignal("");
  const [streaming, setStreaming] = createSignal(false);
  const [pendingPlan, setPendingPlan] = createSignal<PlanTask[] | null>(null);
  const [events, setEvents] = createSignal<LogEntry[]>([]);
  const [statusText, setStatusText] = createSignal("");
  const [error, setError] = createSignal("");
  const [lastMessage, setLastMessage] = createSignal("");
  const [orchestratorSystem, setOrchestratorSystem] = createSignal("");

  // Fetch orchestrator system prompt
  getJson<{ systemPrompt: string }>("/api/agents/orchestrator")
    .then((data) => setOrchestratorSystem(data.systemPrompt))
    .catch(() => {});

  function resetChat() {
    setConversationId(null);
    setMessages([]);
    setEvents([]);
    setCurrentText("");
    setPendingPlan(null);
    setStatusText("");
    setLastMessage("");
  }

  async function send(body: Record<string, unknown>, userLabel?: string) {
    if (streaming()) return;

    if (userLabel) {
      setMessages((prev) => [...prev, { role: "user", content: userLabel }]);
    }

    setStreaming(true);
    setError("");
    setCurrentText("");
    setStatusText("");

    if (conversationId()) body.conversationId = conversationId();

    try {
      const res = await postSse("/api/agents/orchestrator", body);
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
        if (evt.event === "error" && parsed.error) {
          setError(parsed.error);
        }
        if (evt.event === "agent-plan" && parsed.tasks) {
          setPendingPlan(parsed.tasks);
        }
        if (evt.event === "done" && parsed.awaitingApproval && parsed.tasks) {
          setPendingPlan(parsed.tasks);
        }
      }

      if (fullText) {
        setMessages((prev) => [
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

  function runQuickTest(test: QuickTest) {
    setLastMessage(test.message);
    send(
      {
        message: test.message,
        planMode: test.planMode ?? false,
        autonomous: test.autonomous ?? true,
      },
      test.message,
    );
  }

  async function approvePlan() {
    const plan = pendingPlan();
    if (!plan) return;
    setPendingPlan(null);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: "(Approved plan)" },
    ]);
    await send({
      message: lastMessage() || "Execute the approved plan",
      approvedPlan: plan,
      autonomous: true,
    });
  }

  function rejectPlan() {
    setPendingPlan(null);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "(Plan rejected by user)" },
    ]);
  }

  return (
    <div class="flex-1 flex overflow-hidden">
      {/* Left: main orchestrator content */}
      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header bar */}
        <div class="px-6 py-4 border-b border-border-subtle flex items-center gap-3">
          <h2 class="font-display text-lg font-semibold text-heading">Orchestrator</h2>
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

        {/* Quick test buttons (shown when no messages) */}
        <Show when={messages().length === 0}>
          <div class="px-6 py-4 border-b border-border-subtle space-y-3">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Click to test orchestrator behavior
            </span>
            <div class="flex flex-wrap gap-2">
              <For each={quickTests}>
                {(test) => (
                  <button
                    class={`rounded-md px-3 py-2 text-sm font-medium border transition-colors disabled:opacity-40 ${
                      test.planMode
                        ? "bg-warning/10 border-warning/20 text-warning hover:bg-warning/20"
                        : test.autonomous === false
                          ? "bg-purple/10 border-purple/20 text-purple hover:bg-purple/20"
                          : "bg-raised border-border text-primary hover:border-accent/30"
                    }`}
                    onClick={() => runQuickTest(test)}
                    disabled={streaming()}
                  >
                    {test.label}
                  </button>
                )}
              </For>
            </div>
            <p class="text-xs text-muted">
              Default = autonomous &middot; Amber = plan mode (needs approval) &middot; Purple = non-autonomous (shows plan)
            </p>
          </div>
        </Show>

        {/* Request info */}
        <Show when={orchestratorSystem()}>
          <div class="px-6 py-3 border-b border-border-subtle">
            <RequestInfo
              agent="orchestrator"
              system={orchestratorSystem()}
            />
          </div>
        </Show>

        {/* Scrollable message area */}
        <div class="flex-1 overflow-auto panel-scroll p-4 space-y-3">
          <For each={messages()}>
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

          <Show when={pendingPlan()}>
            <div class="bg-warning/5 border border-warning/20 rounded-lg p-4 space-y-3">
              <p class="text-sm font-semibold text-warning font-display">
                Pending Plan ({pendingPlan()!.length} tasks)
              </p>
              <div class="space-y-2">
                <For each={pendingPlan()!}>
                  {(task, i) => (
                    <div class="bg-warning/8 rounded-md px-3 py-2 text-sm">
                      <span class="text-warning font-medium font-mono">
                        Task {i() + 1}:
                      </span>{" "}
                      <span class="text-primary">{task.agent}</span>
                      <p class="text-secondary mt-1">{task.query}</p>
                      <Show when={task.skills?.length}>
                        <p class="text-xs text-warning/70 mt-1 font-mono">
                          Skills: {task.skills!.join(", ")}
                        </p>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
              <div class="flex gap-2 pt-1">
                <button
                  class="rounded-md bg-success/10 px-3 py-2 text-sm font-medium text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-40"
                  onClick={approvePlan}
                >
                  Approve & Execute
                </button>
                <button
                  class="rounded-md bg-danger/10 px-3 py-2 text-sm font-medium text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-40"
                  onClick={rejectPlan}
                >
                  Reject
                </button>
              </div>
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

export default OrchestratorPanel;
