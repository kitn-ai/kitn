import { createSignal, For, Show, type Component } from "solid-js";
import { getJson, postJson } from "../lib/api";
import JsonView from "./shared/JsonView.tsx";

interface ToolInfo {
  name: string;
  description: string;
  category?: string;
}

interface QuickTest {
  label: string;
  tool: string;
  input: Record<string, unknown>;
}

const quickTests: QuickTest[] = [
  { label: 'Echo "Hello"', tool: "echo", input: { message: "Hello from test client!" } },
  { label: "Weather: Tokyo", tool: "getWeather", input: { location: "Tokyo" } },
  { label: "Weather: New York", tool: "getWeather", input: { location: "New York" } },
  { label: "Calc: 2+3*4", tool: "calculate", input: { expression: "2 + 3 * 4" } },
  { label: "Calc: sqrt(144)", tool: "calculate", input: { expression: "144 ** 0.5" } },
  { label: "Calc: (10^3)/7", tool: "calculate", input: { expression: "(10 ** 3) / 7" } },
];

const ToolsPanel: Component = () => {
  const [tools, setTools] = createSignal<ToolInfo[]>([]);
  const [result, setResult] = createSignal<unknown>(null);
  const [activeTest, setActiveTest] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  async function loadTools() {
    try {
      const data = await getJson<{ tools: ToolInfo[] }>("/api/tools");
      setTools(data.tools);
    } catch (e: any) {
      setError(e.message);
    }
  }

  loadTools();

  async function runQuickTest(test: QuickTest) {
    setLoading(true);
    setError("");
    setResult(null);
    setActiveTest(test.label);
    try {
      const data = await postJson(`/api/tools/${test.tool}`, test.input);
      setResult(data);
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
          <h2 class="font-display text-xl font-semibold text-heading">Tools</h2>
          <p class="text-sm text-secondary mt-1">Browse registered tools and run quick tests</p>
        </div>

        <Show when={tools().length > 0}>
          <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">{tools().length} Tools Registered</div>
            <div class="space-y-2">
              <For each={tools()}>
                {(t) => (
                  <div class="bg-surface rounded-lg border border-border px-4 py-3 text-sm">
                    <span class="font-medium text-accent">{t.name}</span>
                    <span class="text-secondary ml-2">{t.description}</span>
                    <Show when={t.category}>
                      <span class="ml-2 text-xs text-muted">({t.category})</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
          <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Quick Tests</div>
          <div class="flex flex-wrap gap-2">
            <For each={quickTests}>
              {(test) => (
                <button
                  class={`rounded-md px-3 py-2 text-sm font-medium border transition-colors disabled:opacity-40 ${
                    activeTest() === test.label
                      ? "bg-accent text-root border-accent"
                      : "bg-raised text-primary border-border hover:border-accent/30"
                  }`}
                  onClick={() => runQuickTest(test)}
                  disabled={loading()}
                >
                  {loading() && activeTest() === test.label ? "Running..." : test.label}
                </button>
              )}
            </For>
          </div>
        </div>

        {error() && <p class="text-sm text-danger">{error()}</p>}
        <Show when={result()}>
          <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Result: {activeTest()}</div>
            <JsonView data={result()} />
          </div>
        </Show>
      </div>
    </div>
  );
};

export default ToolsPanel;
