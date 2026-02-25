import { createSignal, Show, type Component } from "solid-js";
import { getJson } from "../lib/api";
import JsonView from "./shared/JsonView.tsx";

const HealthPanel: Component = () => {
  const [result, setResult] = createSignal<unknown>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  async function checkHealth() {
    setLoading(true);
    setError("");
    try {
      const data = await getJson("/api/health");
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Auto-run on mount
  checkHealth();

  return (
    <div class="flex-1 overflow-auto panel-scroll">
      <div class="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h2 class="font-display text-xl font-semibold text-heading">Health Check</h2>
          <p class="text-sm text-secondary mt-1">Monitor server status and connectivity</p>
        </div>

        <div class="bg-surface rounded-lg border border-border p-4 space-y-4">
          <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Server Status</div>
          <button
            class="rounded-md bg-accent px-3 py-2 text-sm font-medium text-root hover:bg-accent-bright transition-colors disabled:opacity-40"
            onClick={checkHealth}
            disabled={loading()}
          >
            {loading() ? "Checking..." : "Refresh"}
          </button>
          {error() && <p class="text-sm text-danger">{error()}</p>}
          <Show when={result()}>
            <JsonView data={result()} />
          </Show>
        </div>
      </div>
    </div>
  );
};

export default HealthPanel;
