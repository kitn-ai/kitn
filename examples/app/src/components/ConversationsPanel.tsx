import { createSignal, For, Show, type Component } from "solid-js";
import { getJson, postJson, deleteJson } from "../lib/api";
import JsonView from "./shared/JsonView.tsx";

interface ConversationSummary {
  id: string;
  messageCount: number;
  createdAt?: string;
  updatedAt?: string;
}

const ConversationsPanel: Component = () => {
  const [conversations, setConversations] = createSignal<ConversationSummary[]>([]);
  const [messages, setMessages] = createSignal<unknown[]>([]);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<unknown>(null);
  const [activeAction, setActiveAction] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [statusMsg, setStatusMsg] = createSignal("");

  async function run(label: string, fn: () => Promise<void>) {
    setLoading(true);
    setError("");
    setStatusMsg("");
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

  async function listConversations() {
    const data = await getJson<{ conversations: ConversationSummary[] }>("/api/conversations");
    setConversations(data.conversations);
    setResult(data);
  }

  listConversations();

  return (
    <div class="flex-1 overflow-auto panel-scroll">
      <div class="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h2 class="font-display text-xl font-semibold text-heading">Conversations</h2>
          <p class="text-sm text-secondary mt-1">Create, browse, compact, and delete conversations</p>
        </div>

        <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
          <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Quick Actions</div>
          <div class="flex flex-wrap gap-2">
            <button
              class="rounded-md bg-raised px-3 py-2 text-sm font-medium text-primary border border-border hover:border-accent/30 transition-colors disabled:opacity-40"
              onClick={() => run("List all", listConversations)}
              disabled={loading()}
            >
              Refresh List
            </button>
            <button
              class="rounded-md bg-success/10 px-3 py-2 text-sm font-medium text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-40"
              onClick={() =>
                run("Create conversation", async () => {
                  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                  const data = await postJson("/api/conversations", { id });
                  setResult(data);
                  setStatusMsg(`Created conversation ${id}`);
                  await listConversations();
                })
              }
              disabled={loading()}
            >
              Create New
            </button>
            <button
              class="rounded-md bg-success/10 px-3 py-2 text-sm font-medium text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-40"
              onClick={() =>
                run("Create with custom ID", async () => {
                  const data = await postJson("/api/conversations", {
                    id: `test-conv-${Date.now()}`,
                  });
                  setResult(data);
                  setStatusMsg("Created conversation with custom ID");
                  await listConversations();
                })
              }
              disabled={loading()}
            >
              Create with Custom ID
            </button>
          </div>
        </div>

        <Show when={conversations().length > 0}>
          <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">{conversations().length} Conversation(s)</div>
            <div class="space-y-2">
              <For each={conversations()}>
                {(conv) => (
                  <div class="flex items-center gap-2 bg-surface rounded-lg border border-border px-4 py-3 text-sm">
                    <span class="font-mono text-accent text-xs">{conv.id}</span>
                    <span class="text-secondary">{conv.messageCount} msgs</span>
                    <span class="flex-1" />
                    <button
                      class="rounded-md bg-info/10 px-2 py-1 text-xs font-medium text-info border border-info/20 hover:bg-info/20 transition-colors"
                      onClick={() =>
                        run(`View ${conv.id}`, async () => {
                          setSelected(conv.id);
                          const data = await getJson<{ messages: unknown[] }>(
                            `/api/conversations/${conv.id}`,
                          );
                          setMessages(data.messages);
                          setResult(data);
                        })
                      }
                    >
                      View
                    </button>
                    <button
                      class="rounded-md bg-warning/10 px-2 py-1 text-xs font-medium text-warning border border-warning/20 hover:bg-warning/20 transition-colors"
                      onClick={() =>
                        run(`Compact ${conv.id}`, async () => {
                          const data = await postJson(
                            `/api/conversations/${conv.id}/compact`,
                            { preserveRecent: 4 },
                          );
                          setResult(data);
                          setStatusMsg(`Compacted ${conv.id}`);
                        })
                      }
                    >
                      Compact
                    </button>
                    <button
                      class="rounded-md bg-danger/10 px-2 py-1 text-xs font-medium text-danger border border-danger/20 hover:bg-danger/20 transition-colors"
                      onClick={() =>
                        run(`Delete ${conv.id}`, async () => {
                          await deleteJson(`/api/conversations/${conv.id}`);
                          setStatusMsg(`Deleted ${conv.id}`);
                          if (selected() === conv.id) {
                            setSelected(null);
                            setMessages([]);
                          }
                          await listConversations();
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={selected() && messages().length > 0}>
          <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Messages in: {selected()}
            </div>
            <div class="max-h-80 overflow-auto space-y-2">
              <For each={messages()}>
                {(msg: any) => (
                  <div
                    class={`rounded-lg px-4 py-3 text-sm border ${
                      msg.role === "user"
                        ? "bg-accent/5 border-accent/20"
                        : "bg-surface border-border"
                    }`}
                  >
                    <span class="font-medium text-xs text-muted">
                      {msg.role}
                    </span>
                    <p class="mt-1 text-primary whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {error() && <p class="text-sm text-danger">{error()}</p>}
        {statusMsg() && <p class="text-sm text-success">{statusMsg()}</p>}
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

export default ConversationsPanel;
