import { createSignal, lazy, Suspense, For, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";

const panels = {
  Health: lazy(() => import("./components/HealthPanel.tsx")),
  Agents: lazy(() => import("./components/AgentsPanel.tsx")),
  Chat: lazy(() => import("./components/ChatPanel.tsx")),
  Orchestrator: lazy(() => import("./components/OrchestratorPanel.tsx")),
  Tools: lazy(() => import("./components/ToolsPanel.tsx")),
  Generate: lazy(() => import("./components/GeneratePanel.tsx")),
  Voice: lazy(() => import("./components/VoicePanel.tsx")),
  Memory: lazy(() => import("./components/MemoryPanel.tsx")),
  Skills: lazy(() => import("./components/SkillsPanel.tsx")),
  Conversations: lazy(() => import("./components/ConversationsPanel.tsx")),
} as const;

type Tab = keyof typeof panels;

interface NavSection {
  label: string;
  items: Tab[];
}

const sections: NavSection[] = [
  { label: "Overview", items: ["Health"] },
  { label: "Agents", items: ["Agents", "Chat", "Orchestrator"] },
  { label: "Resources", items: ["Tools", "Generate", "Voice"] },
  { label: "Data", items: ["Memory", "Skills", "Conversations"] },
];

const App: Component = () => {
  const [active, setActive] = createSignal<Tab>("Health");

  return (
    <div class="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <nav class="w-[260px] shrink-0 flex flex-col bg-surface border-r border-border">
        {/* Brand */}
        <div class="px-5 pt-5 pb-4 border-b border-border-subtle">
          <h1 class="font-display text-lg font-bold text-heading tracking-tight">
            AI Plugin
          </h1>
          <p class="text-[11px] text-muted mt-0.5">Test Client</p>
        </div>

        {/* Navigation */}
        <div class="flex-1 overflow-auto py-4 px-3 space-y-5 panel-scroll">
          <For each={sections}>
            {(section) => (
              <div>
                <p class="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  {section.label}
                </p>
                <div class="space-y-0.5">
                  <For each={section.items}>
                    {(tab) => (
                      <button
                        class={`w-full rounded-r-md px-3 py-2 text-left text-[13px] font-medium transition-all duration-150 ${
                          active() === tab
                            ? "bg-accent/8 text-accent border-l-2 border-accent pl-[10px]"
                            : "text-secondary hover:text-primary hover:bg-raised/60 border-l-2 border-transparent pl-[10px]"
                        }`}
                        onClick={() => setActive(tab)}
                      >
                        {tab}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        {/* Footer */}
        <div class="px-5 py-3 border-t border-border-subtle">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-success animate-pulse-dot" />
            <p class="text-[10px] text-muted">localhost:4000</p>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main class="flex-1 flex flex-col overflow-hidden bg-root">
        <Suspense
          fallback={
            <div class="flex-1 flex items-center justify-center">
              <div class="spinner" />
            </div>
          }
        >
          <Dynamic component={panels[active()]} />
        </Suspense>
      </main>
    </div>
  );
};

export default App;
