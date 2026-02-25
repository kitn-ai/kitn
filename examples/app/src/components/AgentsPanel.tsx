import { createSignal, For, Show, type Component } from "solid-js";
import { getJson, postJson, postSse } from "../lib/api";
import { parseSseStream } from "@kitnai/client";
import EventLog, { type LogEntry } from "./shared/EventLog.tsx";
import JsonView from "./shared/JsonView.tsx";
import RequestInfo from "./shared/RequestInfo.tsx";

interface AgentInfo {
  name: string;
  description: string;
  toolNames: string[];
  defaultFormat: string;
  systemPrompt?: string;
}

interface QuickPrompt {
  label: string;
  agent: string;
  message: string;
  format: "sse" | "json";
}

const quickPrompts: QuickPrompt[] = [
  { label: "General: Echo test (SSE)", agent: "general", message: "Echo back: Hello from the test client!", format: "sse" },
  { label: "General: Weather Tokyo (SSE)", agent: "general", message: "What's the weather like in Tokyo right now?", format: "sse" },
  { label: "General: Calculate 15% tip on $84.50 (SSE)", agent: "general", message: "Calculate a 15% tip on a bill of $84.50", format: "sse" },
  { label: "General: Multi-tool (SSE)", agent: "general", message: "What's 72 * 1.15? Also, what's the weather in London?", format: "sse" },
  { label: "General: Echo test (JSON)", agent: "general", message: "Echo back: JSON mode test", format: "json" },
  { label: "Guarded: Allowed message", agent: "guarded", message: "Hello, this should work fine!", format: "sse" },
  { label: "Guarded: Blocked message", agent: "guarded", message: "This message contains blocked keyword", format: "sse" },
];

const AgentsPanel: Component = () => {
  const [agents, setAgents] = createSignal<AgentInfo[]>([]);
  const [response, setResponse] = createSignal("");
  const [jsonResult, setJsonResult] = createSignal<unknown>(null);
  const [events, setEvents] = createSignal<LogEntry[]>([]);
  const [activePrompt, setActivePrompt] = createSignal<QuickPrompt | null>(null);
  const [agentSystem, setAgentSystem] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  // Cache system prompts per agent
  const systemPromptCache = new Map<string, string>();

  async function loadAgents() {
    try {
      const data = await getJson<{ agents: AgentInfo[] }>("/api/agents");
      setAgents(data.agents);
    } catch (e: any) {
      setError(e.message);
    }
  }

  loadAgents();

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

  async function runPrompt(qp: QuickPrompt) {
    setLoading(true);
    setError("");
    setResponse("");
    setJsonResult(null);
    setEvents([]);
    setActivePrompt(qp);

    const system = await fetchSystemPrompt(qp.agent);
    setAgentSystem(system);

    try {
      if (qp.format === "json") {
        const data = await postJson(`/api/agents/${qp.agent}?format=json`, {
          message: qp.message,
        });
        setJsonResult(data);
      } else {
        const res = await postSse(`/api/agents/${qp.agent}`, {
          message: qp.message,
        });
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
          if (evt.event === "text-delta" && parsed.text) {
            fullText += parsed.text;
            setResponse(fullText);
          }
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="flex-1 overflow-auto panel-scroll">
      <div class="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h2 class="font-display text-xl font-semibold text-heading">Agents</h2>
          <p class="text-sm text-secondary mt-1">Registered agents and quick prompt testing</p>
        </div>

        <Show when={agents().length > 0}>
          <div class="space-y-2">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
              {agents().length} agents registered
            </span>
            <div class="space-y-1.5">
              <For each={agents()}>
                {(a) => (
                  <div class="bg-surface rounded-lg border border-border px-4 py-3 text-sm flex items-baseline gap-2">
                    <span class="font-medium text-accent font-mono">{a.name}</span>
                    <span class="text-secondary">{a.description}</span>
                    <span class="text-xs text-muted font-mono ml-auto shrink-0">
                      [{a.toolNames.join(", ")}]
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="space-y-3">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Quick Prompts
          </span>
          <div class="flex flex-wrap gap-2">
            <For each={quickPrompts}>
              {(qp) => (
                <button
                  class={`rounded-md px-3 py-2 text-sm font-medium border transition-colors disabled:opacity-40 ${
                    activePrompt()?.label === qp.label
                      ? "bg-accent px-3 py-2 text-root border-accent"
                      : qp.label.includes("Blocked")
                        ? "bg-danger/10 border-danger/20 text-danger hover:bg-danger/20"
                        : qp.format === "json"
                          ? "bg-warning/10 border-warning/20 text-warning hover:bg-warning/20"
                          : "bg-raised border-border text-primary hover:border-accent/30"
                  }`}
                  onClick={() => runPrompt(qp)}
                  disabled={loading()}
                >
                  {loading() && activePrompt()?.label === qp.label ? "Running..." : qp.label}
                </button>
              )}
            </For>
          </div>
        </div>

        {error() && <p class="text-sm text-danger">{error()}</p>}

        <Show when={activePrompt()}>
          <RequestInfo
            agent={activePrompt()!.agent}
            format={activePrompt()!.format}
            system={agentSystem()}
            prompt={activePrompt()!.message}
          />
        </Show>

        <Show when={response()}>
          <div class="space-y-2">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Response
            </span>
            <div class="bg-surface rounded-lg border border-border p-4 text-sm text-primary whitespace-pre-wrap">
              {response()}
            </div>
          </div>
        </Show>

        <Show when={jsonResult()}>
          <JsonView data={jsonResult()} />
        </Show>

        <Show when={events().length > 0}>
          <div class="space-y-2">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Event Log ({events().length})
            </span>
            <div class="bg-surface rounded-lg border border-border overflow-hidden">
              <EventLog entries={events()} />
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default AgentsPanel;
