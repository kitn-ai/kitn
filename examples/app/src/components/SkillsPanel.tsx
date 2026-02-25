import { createSignal, For, Show, type Component } from "solid-js";
import { getJson, postJson, putJson, deleteJson } from "../lib/api";
import JsonView from "./shared/JsonView.tsx";

interface SkillMeta {
  name: string;
  description?: string;
  phase?: string;
}

const sampleSkills = [
  {
    name: "concise",
    content: `---
description: Respond concisely
phase: response
---
# Instructions
Keep all responses under 3 sentences. Be direct and avoid filler words.`,
  },
  {
    name: "formal-tone",
    content: `---
description: Use formal language
phase: response
---
# Instructions
Use professional, formal language. Avoid contractions, slang, and casual expressions.`,
  },
  {
    name: "step-by-step",
    content: `---
description: Break down answers into numbered steps
phase: response
---
# Instructions
Structure every answer as numbered steps. Start each step with an action verb.`,
  },
];

const SkillsPanel: Component = () => {
  const [skills, setSkills] = createSignal<SkillMeta[]>([]);
  const [result, setResult] = createSignal<unknown>(null);
  const [activeAction, setActiveAction] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");

  async function run(label: string, fn: () => Promise<void>) {
    setLoading(true);
    setError("");
    setMessage("");
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

  async function listSkills() {
    const data = await getJson<{ skills: SkillMeta[] }>("/api/skills");
    setSkills(data.skills);
    setResult(data);
  }

  listSkills();

  return (
    <div class="flex-1 overflow-auto panel-scroll">
      <div class="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h2 class="font-display text-xl font-semibold text-heading">Skills</h2>
          <p class="text-sm text-secondary mt-1">Create, view, update, and delete agent skills</p>
        </div>

        <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
          <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Create Sample Skills</div>
          <div class="flex flex-wrap gap-2">
            <For each={sampleSkills}>
              {(skill) => (
                <button
                  class="rounded-md bg-success/10 px-3 py-2 text-sm font-medium text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-40"
                  onClick={() =>
                    run(`Create "${skill.name}"`, async () => {
                      await postJson("/api/skills", {
                        name: skill.name,
                        content: skill.content,
                      });
                      setMessage(`Created skill "${skill.name}"`);
                      await listSkills();
                    })
                  }
                  disabled={loading()}
                >
                  Create "{skill.name}"
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
          <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">Actions</div>
          <div class="flex flex-wrap gap-2">
            <button
              class="rounded-md bg-raised px-3 py-2 text-sm font-medium text-primary border border-border hover:border-accent/30 transition-colors disabled:opacity-40"
              onClick={() => run("List skills", listSkills)}
              disabled={loading()}
            >
              Refresh List
            </button>
            <For each={skills()}>
              {(skill) => (
                <>
                  <button
                    class="rounded-md bg-info/10 px-3 py-2 text-sm font-medium text-info border border-info/20 hover:bg-info/20 transition-colors disabled:opacity-40"
                    onClick={() =>
                      run(`View "${skill.name}"`, async () => {
                        const data = await getJson(`/api/skills/${skill.name}`);
                        setResult(data);
                      })
                    }
                    disabled={loading()}
                  >
                    View "{skill.name}"
                  </button>
                  <button
                    class="rounded-md bg-warning/10 px-3 py-2 text-sm font-medium text-warning border border-warning/20 hover:bg-warning/20 transition-colors disabled:opacity-40"
                    onClick={() =>
                      run(`Update "${skill.name}"`, async () => {
                        await putJson(`/api/skills/${skill.name}`, {
                          content: `---\ndescription: Updated skill\nphase: response\n---\n# Updated Instructions\nThis skill was updated by the test client at ${new Date().toLocaleTimeString()}.`,
                        });
                        setMessage(`Updated skill "${skill.name}"`);
                        await listSkills();
                      })
                    }
                    disabled={loading()}
                  >
                    Update "{skill.name}"
                  </button>
                  <button
                    class="rounded-md bg-danger/10 px-3 py-2 text-sm font-medium text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-40"
                    onClick={() =>
                      run(`Delete "${skill.name}"`, async () => {
                        await deleteJson(`/api/skills/${skill.name}`);
                        setMessage(`Deleted skill "${skill.name}"`);
                        await listSkills();
                      })
                    }
                    disabled={loading()}
                  >
                    Delete "{skill.name}"
                  </button>
                </>
              )}
            </For>
          </div>
        </div>

        <Show when={skills().length > 0}>
          <div class="bg-surface rounded-lg border border-border p-4 space-y-3">
            <div class="text-[10px] font-semibold uppercase tracking-widest text-muted">{skills().length} Skill(s)</div>
            <div class="space-y-2">
              <For each={skills()}>
                {(skill) => (
                  <div class="bg-surface rounded-lg border border-border px-4 py-3 text-sm">
                    <span class="font-medium text-accent">{skill.name}</span>
                    <Show when={skill.phase}>
                      <span class="text-xs text-muted ml-2">({skill.phase})</span>
                    </Show>
                    <Show when={skill.description}>
                      <span class="text-secondary ml-2">{skill.description}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {error() && <p class="text-sm text-danger">{error()}</p>}
        {message() && <p class="text-sm text-success">{message()}</p>}
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

export default SkillsPanel;
