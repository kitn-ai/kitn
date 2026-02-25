/**
 * Shared test helpers for @jombee/ai test suite.
 */
import { tool } from "ai";
import { z } from "zod";
import { AgentRegistry, CardRegistry, DEFAULTS } from "../src/index.js";
import { ToolRegistry } from "../src/registry/tool-registry.js";
import type { PluginContext } from "../src/context.js";
import type { AgentRegistration } from "../src/registry/agent-registry.js";
import type { StorageProvider } from "../src/storage/interfaces.js";

/** Minimal LanguageModel mock that resolves without network calls. */
export function makeMockModel(textResponse = "mock response") {
  return {
    specificationVersion: "v1" as const,
    provider: "mock",
    modelId: "mock-model",
    defaultObjectGenerationMode: "json" as const,
    doGenerate: async () => ({
      text: textResponse,
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 5 },
      rawCall: { rawPrompt: "", rawSettings: {} },
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: textResponse });
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: { promptTokens: 10, completionTokens: 5 },
          });
          controller.close();
        },
      }),
      rawCall: { rawPrompt: "", rawSettings: {} },
    }),
  };
}

/** Minimal in-memory StorageProvider that satisfies the interface. */
export function makeStorage(): StorageProvider {
  const conversations = new Map<string, any>();

  return {
    conversations: {
      get: async (id) => conversations.get(id) ?? null,
      list: async () => [],
      create: async (id) => {
        const c = { id, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        conversations.set(id, c);
        return c;
      },
      append: async (id, msg) => {
        const c = conversations.get(id) ?? { id, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        c.messages.push(msg);
        conversations.set(id, c);
        return c;
      },
      delete: async (id) => conversations.delete(id),
      clear: async (id) => {
        const c = conversations.get(id);
        if (c) { c.messages = []; }
        return c;
      },
    },
    memory: {
      listNamespaces: async () => [],
      listEntries: async () => [],
      saveEntry: async (ns, key, value, context = "") => ({
        key, value, context,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getEntry: async () => null,
      deleteEntry: async () => false,
      clearNamespace: async () => {},
      loadMemoriesForIds: async () => [],
    },
    skills: {
      listSkills: async () => [],
      getSkill: async () => null,
      createSkill: async (name, content) => ({
        name, description: "", tags: [], phase: "both" as const,
        content, rawContent: content, updatedAt: new Date().toISOString(),
      }),
      updateSkill: async (name, content) => ({
        name, description: "", tags: [], phase: "both" as const,
        content, rawContent: content, updatedAt: new Date().toISOString(),
      }),
      deleteSkill: async () => false,
      getSkillSummaries: async () => "(no skills configured)",
    },
    tasks: {
      createTask: async (title) => ({
        id: "t1", title, status: "todo" as const,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      listTasks: async () => [],
      updateTask: async (id, updates) => ({
        id, title: updates.title ?? "", status: updates.status ?? "todo" as const,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }),
      deleteTask: async () => false,
    },
    prompts: {
      loadOverrides: async () => ({}),
      saveOverride: async (_name, prompt) => ({ prompt, updatedAt: new Date().toISOString() }),
      deleteOverride: async () => false,
    },
    audio: {
      saveAudio: async (_buffer, mimeType) => ({
        id: "a1", mimeType, size: 0, createdAt: new Date().toISOString(),
      }),
      getAudio: async () => null,
      deleteAudio: async () => false,
      listAudio: async () => [],
      cleanupOlderThan: async () => 0,
    },
  };
}

/** Create a fresh PluginContext with clean registries. */
export function makeCtx(overrides?: Partial<PluginContext>): PluginContext {
  return {
    agents: new AgentRegistry(),
    tools: new ToolRegistry(),
    storage: makeStorage(),
    getModel: () => makeMockModel() as any,
    cards: new CardRegistry(),
    maxDelegationDepth: DEFAULTS.MAX_DELEGATION_DEPTH,
    defaultMaxSteps: DEFAULTS.MAX_STEPS,
    config: {
      getModel: () => makeMockModel() as any,
      storage: makeStorage(),
    } as any,
    ...overrides,
  };
}

/** Reusable hello tool for agent registrations. */
export const helloTool = tool({
  description: "Say hello",
  parameters: z.object({ name: z.string() }),
  execute: async ({ name }) => `Hello, ${name}!`,
});

/** Register a non-orchestrator specialist agent with a real tool. */
export function registerSpecialist(
  ctx: PluginContext,
  name: string,
  extraTools: Record<string, any> = {},
): AgentRegistration {
  const reg: AgentRegistration = {
    name,
    description: `${name} specialist`,
    toolNames: ["hello", ...Object.keys(extraTools)],
    defaultFormat: "json",
    defaultSystem: `You are the ${name} agent.`,
    tools: { hello: helloTool, ...extraTools },
  };
  ctx.agents.register(reg);
  return reg;
}
