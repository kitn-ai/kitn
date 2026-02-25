import { createSignal, For, Show, type Component } from "solid-js";
import { getJson, postJson, deleteJson } from "../lib/api";
import JsonView from "./shared/JsonView.tsx";

interface MemoryEntry {
  key: string;
  value: unknown;
  context?: string;
}

interface QuickAction {
  label: string;
  action: () => Promise<void>;
  color?: string;
}

const MemoryPanel: Component = () => {
  const [entries, setEntries] = createSignal<MemoryEntry[]>([]);
  const [result, setResult] = createSignal<unknown>(null);
  const [activeAction, setActiveAction] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  async function run(label: string, fn: () => Promise<void>) {
    setLoading(true);
    setError("");
    setResult(null);
    setActiveAction(label);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function listEntries() {
    const data = await getJson<{ entries: MemoryEntry[] }>("/api/memory/default");
    setEntries(data.entries);
    setResult(data);
  }

  const quickActions: QuickAction[] = [
    {
      label: "List All (default ns)",
      action: listEntries,
    },
    {
      label: 'Set "user-name" = "Alice"',
      action: async () => {
        const data = await postJson("/api/memory/default", {
          key: "user-name",
          value: "Alice",
          context: "Test user preference",
        });
        setResult(data);
        await listEntries();
      },
    },
    {
      label: 'Set "favorite-color" = "blue"',
      action: async () => {
        const data = await postJson("/api/memory/default", {
          key: "favorite-color",
          value: "blue",
        });
        setResult(data);
        await listEntries();
      },
    },
    {
      label: 'Set "settings" = {theme: "dark", lang: "en"}',
      action: async () => {
        const data = await postJson("/api/memory/default", {
          key: "settings",
          value: JSON.stringify({ theme: "dark", lang: "en" }),
          context: "User settings object",
        });
        setResult(data);
        await listEntries();
      },
    },
    {
      label: 'Get "user-name"',
      action: async () => {
        const data = await getJson("/api/memory/default/user-name");
        setResult(data);
      },
    },
    {
      label: 'Delete "user-name"',
      action: async () => {
        const data = await deleteJson("/api/memory/default/user-name");
        setResult(data);
        await listEntries();
      },
      color: "red",
    },
    {
      label: "List (test-ns)",
      action: async () => {
        const data = await getJson<{ entries: MemoryEntry[] }>("/api/memory/test-ns");
        setResult(data);
      },
    },
    {
      label: 'Set in test-ns: "count" = 42',
      action: async () => {
        const data = await postJson("/api/memory/test-ns", {
          key: "count",
          value: "42",
        });
        setResult(data);
      },
    },
  ];

  return (
    <div class="flex-1 overflow-auto panel-scroll">
      <div class="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h2 class="font-display text-xl font-semibold text-heading">Memory</h2>
          <p class="text-sm text-secondary mt-1">Manage key-value memory entries across namespaces</p>
        </div>

        <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
          <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Quick Actions</div>
          <div class="flex flex-wrap gap-2">
            <For each={quickActions}>
              {(qa) => (
                <button
                  class={`rounded-md px-3 py-2 text-sm font-medium border transition-colors disabled:opacity-40 ${
                    qa.color === "red"
                      ? "bg-danger/10 text-danger border-danger/20 hover:bg-danger/20"
                      : activeAction() === qa.label
                        ? "bg-accent text-root border-accent"
                        : "bg-raised text-primary border-border hover:border-accent/30"
                  }`}
                  onClick={() => run(qa.label, qa.action)}
                  disabled={loading()}
                >
                  {loading() && activeAction() === qa.label ? "Running..." : qa.label}
                </button>
              )}
            </For>
          </div>
        </div>

        <Show when={entries().length > 0}>
          <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">{entries().length} Entries in "default"</div>
            <div class="space-y-2">
              <For each={entries()}>
                {(entry) => (
                  <div class="flex items-center gap-2 bg-surface rounded-lg border border-border px-4 py-3 text-sm">
                    <span class="font-medium text-accent">{entry.key}</span>
                    <span class="text-secondary truncate">
                      {JSON.stringify(entry.value)}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {error() && <p class="text-sm text-danger">{error()}</p>}
        <Show when={result()}>
          <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Result: {activeAction()}</div>
            <JsonView data={result()} />
          </div>
        </Show>
      </div>
    </div>
  );
};

export default MemoryPanel;
