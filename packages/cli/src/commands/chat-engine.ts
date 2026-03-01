import pc from "picocolors";
import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir, readdir } from "fs/promises";
import { join, dirname, resolve } from "path";
import { readConfig, readLock } from "../utils/config.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { readUserConfig } from "./config.js";
import type {
  ChatMessage,
  ChatPlan,
  PlanStep,
  ChatServiceResponse,
  WriteFileInput,
  ReadFileInput,
  ListFilesInput,
  UpdateEnvInput,
  ToolCall,
  ToolResult,
} from "./chat-types.js";

const DEFAULT_SERVICE_URL = "https://chat.kitn.dev";
const GLOBAL_REGISTRY_URL = "https://kitn-ai.github.io/registry/registries.json";

export interface GlobalDirectoryEntry {
  name: string;
  url: string;
  homepage?: string;
  description?: string;
}

export interface GlobalRegistryEntry {
  namespace: string;
  url: string;
  items: Array<{ name: string; type: string; description: string; registryDependencies?: string[] }>;
}

export interface ToolCallContext {
  cwd: string;
  availableComponents: string[];
  installedComponents: string[];
}

export interface ProjectContext {
  metadata: Record<string, unknown>;
  availableComponents: string[];
  installedComponents: string[];
  chatServiceConfig?: { url?: string };
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

export function buildServicePayload(messages: ChatMessage[], metadata: Record<string, unknown>, model?: string) {
  return { messages, metadata, ...(model ? { model } : {}) };
}

export function hasToolCalls(response: ChatServiceResponse): boolean {
  return !!(response.message.toolCalls && response.message.toolCalls.length > 0);
}

export function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return `${count}`;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

export function formatSessionStats(elapsedMs: number, totalTokens: number): string {
  return `Session: ${formatElapsed(elapsedMs)} | ${formatTokens(totalTokens)} tokens`;
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

export async function fetchGlobalRegistries(
  configuredNamespaces: string[],
): Promise<GlobalRegistryEntry[]> {
  let directory: GlobalDirectoryEntry[];
  try {
    const res = await fetch(GLOBAL_REGISTRY_URL);
    if (!res.ok) return [];
    directory = await res.json();
  } catch {
    return [];
  }

  const unconfigured = directory.filter(
    (entry) => !configuredNamespaces.includes(entry.name),
  );

  if (unconfigured.length === 0) return [];

  const results: GlobalRegistryEntry[] = [];
  for (const entry of unconfigured) {
    try {
      const indexUrl = entry.url.replace("{type}/{name}.json", "registry.json");
      const res = await fetch(indexUrl);
      if (!res.ok) continue;
      const index = await res.json();
      const items = (index.items ?? []).map((item: any) => ({
        name: item.name,
        type: item.type,
        description: item.description,
        registryDependencies: item.registryDependencies,
      }));
      results.push({ namespace: entry.name, url: entry.url, items });
    } catch {
      // Skip failing registries
    }
  }

  return results;
}

export async function resolveServiceUrl(
  urlOverride?: string,
  chatServiceConfig?: { url?: string },
): Promise<string> {
  if (urlOverride) return urlOverride;
  if (process.env.KITN_CHAT_URL) return process.env.KITN_CHAT_URL;

  const userConfig = await readUserConfig();
  if (userConfig["service-url"]) return userConfig["service-url"];
  if (userConfig["chat-url"]) return userConfig["chat-url"];

  if (chatServiceConfig?.url) return chatServiceConfig.url;

  return DEFAULT_SERVICE_URL;
}

// ---------------------------------------------------------------------------
// Plan formatting
// ---------------------------------------------------------------------------

export function formatPlan(plan: ChatPlan): string {
  const lines: string[] = [plan.summary, ""];

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const num = `${i + 1}.`;
    const label = formatStepLabel(step);
    lines.push(`${num} ${label} - ${step.reason}`);
  }

  return lines.join("\n");
}

export function formatStepLabel(step: PlanStep): string {
  switch (step.action) {
    case "add":
      return `Add ${pc.cyan(step.component!)}`;
    case "remove":
      return `Remove ${pc.red(step.component!)}`;
    case "create":
      return `Create ${pc.green(step.name!)} ${pc.dim(`(${step.type})`)}`;
    case "link":
      return `Link ${pc.cyan(step.toolName!)} → ${pc.cyan(step.agentName!)}`;
    case "unlink":
      return `Unlink ${pc.red(step.toolName!)} from ${pc.cyan(step.agentName!)}`;
    case "registry-add":
      return `Add registry ${pc.magenta(step.namespace!)}`;
    case "update":
      return `Update ${pc.yellow(step.component!)}`;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validatePlan(
  plan: ChatPlan,
  availableComponents: string[],
  installedComponents: string[],
): string[] {
  const errors: string[] = [];
  const availableSet = new Set(availableComponents);
  const installedSet = new Set(installedComponents);

  const beingAdded = new Set(
    plan.steps
      .filter((s) => s.action === "add" && s.component)
      .map((s) => s.component!),
  );
  const beingCreated = new Set(
    plan.steps
      .filter((s) => s.action === "create" && s.name)
      .map((s) => s.name!),
  );

  for (const step of plan.steps) {
    switch (step.action) {
      case "add": {
        if (!step.component) break;
        if (!availableSet.has(step.component)) {
          errors.push(
            `Cannot add "${step.component}" — it does not exist in the registry. ` +
            `Use "create" action instead to scaffold a new custom component. ` +
            `Available components: ${availableComponents.join(", ") || "none"}`
          );
        } else if (installedSet.has(step.component)) {
          errors.push(
            `"${step.component}" is already installed. Use "update" action to update it, or skip this step.`
          );
        }
        break;
      }
      case "create": {
        if (!step.type) {
          errors.push(`Create step is missing "type" (must be one of: agent, tool, skill, storage, cron).`);
        }
        if (!step.name) {
          errors.push(`Create step is missing "name" for the new component.`);
        }
        break;
      }
      case "remove": {
        if (!step.component) break;
        if (!installedSet.has(step.component)) {
          errors.push(
            `Cannot remove "${step.component}" — it is not installed.`
          );
        }
        break;
      }
      case "update": {
        if (!step.component) break;
        if (!installedSet.has(step.component)) {
          errors.push(
            `Cannot update "${step.component}" — it is not installed. Use "add" to install it first.`
          );
        }
        break;
      }
      case "link": {
        if (!step.toolName) {
          errors.push(`Link step is missing "toolName".`);
        } else if (
          !installedSet.has(step.toolName) &&
          !beingAdded.has(step.toolName) &&
          !beingCreated.has(step.toolName)
        ) {
          errors.push(
            `Cannot link tool "${step.toolName}" — it is not installed or being added/created in this plan.`
          );
        }
        if (!step.agentName) {
          errors.push(`Link step is missing "agentName".`);
        }
        break;
      }
      case "unlink": {
        if (!step.toolName) {
          errors.push(`Unlink step is missing "toolName".`);
        }
        if (!step.agentName) {
          errors.push(`Unlink step is missing "agentName".`);
        }
        break;
      }
      case "registry-add": {
        if (!step.namespace) {
          errors.push(`Registry-add step is missing "namespace" (e.g. "@community").`);
        }
        if (!step.url) {
          errors.push(`Registry-add step is missing "url" template.`);
        }
        break;
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

export async function executeStep(step: PlanStep): Promise<void> {
  switch (step.action) {
    case "registry-add": {
      const { registryAddCommand } = await import("./registry.js");
      await registryAddCommand(step.namespace!, step.url!, { overwrite: true });
      break;
    }
    case "add": {
      const { addCommand } = await import("./add.js");
      await addCommand([step.component!], { yes: true });
      break;
    }
    case "create": {
      const { createComponentInProject } = await import("./create.js");
      await createComponentInProject(step.type!, step.name!, { overwrite: true });
      break;
    }
    case "link": {
      const { linkCommand } = await import("./link.js");
      await linkCommand("tool", step.toolName, { to: step.agentName });
      break;
    }
    case "remove": {
      const { removeCommand } = await import("./remove.js");
      await removeCommand(step.component);
      break;
    }
    case "unlink": {
      const { unlinkCommand } = await import("./unlink.js");
      await unlinkCommand("tool", step.toolName, { from: step.agentName });
      break;
    }
    case "update": {
      const { addCommand } = await import("./add.js");
      await addCommand([step.component!], { overwrite: true, yes: true });
      break;
    }
    default:
      throw new Error(`Unknown action type: ${(step as any).action}`);
  }
}

// ---------------------------------------------------------------------------
// File operation handlers
// ---------------------------------------------------------------------------

export async function handleWriteFile(input: WriteFileInput, cwd: string): Promise<string> {
  const fullPath = resolve(cwd, input.path);
  if (!fullPath.startsWith(resolve(cwd))) {
    return `Rejected: path '${input.path}' would escape project directory`;
  }
  await mkdir(dirname(fullPath), { recursive: true });
  await fsWriteFile(fullPath, input.content, "utf-8");
  return `Wrote ${input.path}`;
}

export async function handleReadFile(input: ReadFileInput, cwd: string): Promise<string> {
  const fullPath = resolve(cwd, input.path);
  if (!fullPath.startsWith(resolve(cwd))) {
    return `Rejected: path '${input.path}' would escape project directory`;
  }
  try {
    return await fsReadFile(fullPath, "utf-8");
  } catch {
    return `File not found: ${input.path}`;
  }
}

export async function handleListFiles(input: ListFilesInput, cwd: string): Promise<string> {
  const searchDir = input.directory ? resolve(cwd, input.directory) : cwd;
  if (!searchDir.startsWith(resolve(cwd))) {
    return `Rejected: directory '${input.directory}' would escape project directory`;
  }
  try {
    const entries = await readdir(searchDir, { recursive: true });
    const pattern = input.pattern;
    const filtered = entries.filter((e) => {
      const name = String(e);
      if (pattern.startsWith("*.")) {
        return name.endsWith(pattern.slice(1));
      }
      if (pattern.startsWith("**/") && pattern.includes("*.")) {
        const ext = pattern.slice(pattern.lastIndexOf("*.") + 1);
        return name.endsWith(ext);
      }
      if (pattern.includes("/*.")) {
        const dir = pattern.split("/*.")[0];
        const ext = pattern.split("/*.")[1];
        return name.startsWith(dir) && name.endsWith(ext);
      }
      return true;
    });
    return filtered.length > 0 ? `Files found:\n${filtered.join("\n")}` : "No files found matching the pattern.";
  } catch {
    return `Directory not found: ${input.directory ?? "."}`;
  }
}

export async function handleUpdateEnvDirect(input: UpdateEnvInput, cwd: string, value: string): Promise<string> {
  const envPath = join(cwd, ".env");
  let existing = "";
  try { existing = await fsReadFile(envPath, "utf-8"); } catch {}

  const lines = existing.split("\n");
  const keyIndex = lines.findIndex((l) => l.startsWith(`${input.key}=`));

  let newContent: string;
  if (keyIndex >= 0) {
    lines[keyIndex] = `${input.key}=${value}`;
    newContent = lines.join("\n");
  } else {
    newContent = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + `${input.key}=${value}\n`;
  }

  await fsWriteFile(envPath, newContent, "utf-8");
  return `Successfully set ${input.key} in .env`;
}

// ---------------------------------------------------------------------------
// Non-interactive tool dispatch
// ---------------------------------------------------------------------------

export async function handleNonInteractiveTool(call: ToolCall, ctx: ToolCallContext): Promise<string | null> {
  const input = call.input ?? {};
  switch (call.name) {
    case "writeFile":
      return handleWriteFile(input as WriteFileInput, ctx.cwd);
    case "readFile":
      return handleReadFile(input as ReadFileInput, ctx.cwd);
    case "listFiles":
      return handleListFiles(input as ListFilesInput, ctx.cwd);
    default:
      return null; // Not a non-interactive tool
  }
}

// ---------------------------------------------------------------------------
// Context gathering
// ---------------------------------------------------------------------------

export async function gatherProjectContext(cwd: string): Promise<ProjectContext | null> {
  const config = await readConfig(cwd);
  if (!config) return null;

  const configuredNamespaces = Object.keys(config.registries);
  const fetcher = new RegistryFetcher(config.registries);
  const [indices, globalEntries, lock, rawConfig] = await Promise.all([
    Promise.all(
      configuredNamespaces.map(async (ns) => {
        try {
          return await fetcher.fetchIndex(ns);
        } catch {
          return null;
        }
      }),
    ),
    fetchGlobalRegistries(configuredNamespaces),
    readLock(cwd),
    fsReadFile(join(cwd, "kitn.json"), "utf-8").then((r) => JSON.parse(r)).catch(() => null),
  ]);

  const registryIndex = indices
    .filter(Boolean)
    .flatMap((index: any) => (index.items ?? []).map((item: any) => ({
      name: item.name,
      type: item.type,
      description: item.description,
      registryDependencies: item.registryDependencies,
    })));

  const lockKeys = Object.keys(lock);
  const configInstalledKeys = rawConfig?.installed ? Object.keys(rawConfig.installed) : [];
  const installed = lockKeys.length > 0 ? lockKeys : configInstalledKeys;
  const globalRegistryIndex = globalEntries.length > 0 ? globalEntries : undefined;

  const metadata: Record<string, unknown> = { registryIndex, installed };
  if (globalRegistryIndex) metadata.globalRegistryIndex = globalRegistryIndex;

  const availableComponents = (registryIndex as any[]).map((item: any) => item.name);

  return {
    metadata,
    availableComponents,
    installedComponents: installed,
    chatServiceConfig: config.chatService,
  };
}

// ---------------------------------------------------------------------------
// Service call
// ---------------------------------------------------------------------------

export async function callChatService(
  serviceUrl: string,
  messages: ChatMessage[],
  metadata: Record<string, unknown>,
  model?: string,
): Promise<ChatServiceResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.KITN_API_KEY) headers["Authorization"] = `Bearer ${process.env.KITN_API_KEY}`;

  const res = await fetch(`${serviceUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(buildServicePayload(messages, metadata, model)),
  });

  if (!res.ok) {
    throw new Error(`Service returned ${res.status}: ${res.statusText}`);
  }
  return await res.json() as ChatServiceResponse;
}

export function looksLikePlan(text: string): boolean {
  const hasNumberedSteps = /\d+\.\s/.test(text);
  const hasActionVerbs = /\b(add|create|install|remove|link|scaffold|set up)\b/i.test(text);
  const hasComponentRefs = /\b(agent|tool|skill|storage|cron)\b/i.test(text);
  return hasNumberedSteps && hasActionVerbs && hasComponentRefs;
}

// ---------------------------------------------------------------------------
// Token estimation & compaction
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;
const COMPACTION_TOKEN_LIMIT = 80_000;
const COMPACTION_PRESERVE_TOKENS = 8_000;

export function estimateChatMessageTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.content) total += msg.content.length;
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        total += tc.name.length;
        total += JSON.stringify(tc.input ?? {}).length;
      }
    }
    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        total += tr.toolName.length;
        total += tr.result.length;
      }
    }
  }
  return Math.ceil(total / CHARS_PER_TOKEN);
}

export function checkCompaction(
  messages: ChatMessage[],
): { toSummarize: ChatMessage[]; toPreserve: ChatMessage[] } | null {
  const totalTokens = estimateChatMessageTokens(messages);
  if (totalTokens < COMPACTION_TOKEN_LIMIT) return null;
  if (messages.length <= 1) return null;

  // Walk backwards from newest to oldest, accumulating tokens for the preserve set
  let preserveTokens = 0;
  let splitIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateChatMessageTokens([messages[i]]);
    if (preserveTokens + msgTokens > COMPACTION_PRESERVE_TOKENS) break;
    preserveTokens += msgTokens;
    splitIndex = i;
  }

  // Ensure we preserve at least the last message
  if (splitIndex === messages.length) {
    splitIndex = messages.length - 1;
  }

  // Ensure we have something to summarize
  if (splitIndex === 0) return null;

  return {
    toSummarize: messages.slice(0, splitIndex),
    toPreserve: messages.slice(splitIndex),
  };
}

export async function callCompactService(
  serviceUrl: string,
  messages: ChatMessage[],
  model?: string,
): Promise<{ summary: string; usage: { inputTokens: number; outputTokens: number } }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.KITN_API_KEY) headers["Authorization"] = `Bearer ${process.env.KITN_API_KEY}`;

  const res = await fetch(`${serviceUrl}/api/chat/compact`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages, ...(model ? { model } : {}) }),
  });

  if (!res.ok) {
    throw new Error(`Compact service returned ${res.status}: ${res.statusText}`);
  }
  return await res.json() as { summary: string; usage: { inputTokens: number; outputTokens: number } };
}
