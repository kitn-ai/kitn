import { createSignal, For, Show, type Component } from "solid-js";
import { postJson, postSse } from "../lib/api";
import { parseSseStream } from "@kitnai/client";
import EventLog, { type LogEntry } from "./shared/EventLog.tsx";
import JsonView from "./shared/JsonView.tsx";
import RequestInfo from "./shared/RequestInfo.tsx";

interface QuickGenerate {
  label: string;
  message: string;
  system?: string;
  tools?: string[];
  format: "sse" | "json";
  maxSteps?: number;
}

const quickTests: QuickGenerate[] = [
  {
    label: "Simple prompt (SSE)",
    message: "Explain what a REST API is in 2 sentences.",
    format: "sse",
  },
  {
    label: "With system prompt (SSE)",
    message: "What is TypeScript?",
    system: "You are a pirate. Answer everything in pirate speak.",
    format: "sse",
  },
  {
    label: "Weather tool (SSE)",
    message: "What's the weather in Sydney?",
    tools: ["getWeather"],
    format: "sse",
    maxSteps: 3,
  },
  {
    label: "Calculator tool (SSE)",
    message: "What is the square root of 1764?",
    tools: ["calculate"],
    format: "sse",
    maxSteps: 3,
  },
  {
    label: "All tools (SSE)",
    message: "Echo 'test', check weather in Oslo, and calculate 99*99",
    tools: ["echo", "getWeather", "calculate"],
    format: "sse",
    maxSteps: 5,
  },
  {
    label: "Simple prompt (JSON)",
    message: "Name 3 programming languages and one use case for each.",
    format: "json",
  },
  {
    label: "All tools (JSON)",
    message: "What's the weather in Rome and what is 365*24?",
    tools: ["getWeather", "calculate"],
    format: "json",
    maxSteps: 5,
  },
];

const GeneratePanel: Component = () => {
  const [response, setResponse] = createSignal("");
  const [jsonResult, setJsonResult] = createSignal<unknown>(null);
  const [events, setEvents] = createSignal<LogEntry[]>([]);
  const [activeTest, setActiveTest] = createSignal<QuickGenerate | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  async function runTest(test: QuickGenerate) {
    setLoading(true);
    setError("");
    setResponse("");
    setJsonResult(null);
    setEvents([]);
    setActiveTest(test);

    const body: Record<string, unknown> = {
      prompt: test.message,
      maxSteps: test.maxSteps ?? 5,
    };
    if (test.system) body.systemPrompt = test.system;
    if (test.tools?.length) body.tools = test.tools;

    try {
      if (test.format === "json") {
        const data = await postJson("/api/generate?format=json", body);
        setJsonResult(data);
      } else {
        const res = await postSse("/api/generate?format=sse", body);
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
          <h2 class="font-display text-xl font-semibold text-heading">Generate</h2>
          <p class="text-sm text-secondary mt-1">Low-level generate endpoint with tool and format options</p>
        </div>

        <div class="space-y-3">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Quick Tests
          </span>
          <div class="flex flex-wrap gap-2">
            <For each={quickTests}>
              {(test) => (
                <button
                  class={`rounded-md px-3 py-2 text-sm font-medium border transition-colors disabled:opacity-40 ${
                    activeTest()?.label === test.label
                      ? "bg-accent text-root border-accent"
                      : test.format === "json"
                        ? "bg-warning/10 border-warning/20 text-warning hover:bg-warning/20"
                        : test.tools?.length
                          ? "bg-purple/10 border-purple/20 text-purple hover:bg-purple/20"
                          : "bg-raised border-border text-primary hover:border-accent/30"
                  }`}
                  onClick={() => runTest(test)}
                  disabled={loading()}
                >
                  {loading() && activeTest()?.label === test.label ? "Running..." : test.label}
                </button>
              )}
            </For>
          </div>
          <p class="text-xs text-muted">
            Default = plain prompt &middot; Purple = with tools &middot; Amber = JSON format
          </p>
        </div>

        {error() && <p class="text-sm text-danger">{error()}</p>}

        <Show when={activeTest()}>
          <RequestInfo
            format={activeTest()!.format}
            system={activeTest()!.system}
            prompt={activeTest()!.message}
            tools={activeTest()!.tools}
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
          <div class="space-y-2">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-muted">
              JSON Result
            </span>
            <JsonView data={jsonResult()} />
          </div>
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

export default GeneratePanel;
