import * as p from "@clack/prompts";
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
  AskUserItem,
  WriteFileInput,
  ReadFileInput,
  ListFilesInput,
  UpdateEnvInput,
  ToolCall,
  ToolResult,
} from "./chat-types.js";

const DEFAULT_SERVICE_URL = "https://chat.kitn.dev";
const GLOBAL_REGISTRY_URL = "https://kitn-ai.github.io/registry/registries.json";

interface GlobalDirectoryEntry {
  name: string;
  url: string;
  homepage?: string;
  description?: string;
}

interface GlobalRegistryEntry {
  namespace: string;
  url: string;
  items: Array<{ name: string; type: string; description: string; registryDependencies?: string[] }>;
}

// ---------------------------------------------------------------------------
// Pure helper functions (exported for testing)
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

export function shouldCompact(lastPromptTokens: number, threshold: number): boolean {
  return lastPromptTokens >= threshold;
}

export function applyCompaction(messages: ChatMessage[], summary: string, keepRecent: number = 2): ChatMessage[] {
  const recent = messages.slice(-keepRecent);
  return [
    { role: "user" as const, content: `[Context from earlier in conversation]\n${summary}` },
    ...recent,
  ];
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the global registry directory and return indices for registries
 * not already configured in the user's kitn.json.
 */
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

/**
 * Resolve the chat service URL.
 * Priority: urlOverride (--url flag) > KITN_CHAT_URL env > user config (~/.kitn/config.json) > project config (kitn.json chatService.url) > default
 */
export async function resolveServiceUrl(
  urlOverride?: string,
  chatServiceConfig?: { url?: string },
): Promise<string> {
  if (urlOverride) return urlOverride;
  if (process.env.KITN_CHAT_URL) return process.env.KITN_CHAT_URL;

  // User-level config (~/.kitn/config.json)
  const userConfig = await readUserConfig();
  if (userConfig["chat-url"]) return userConfig["chat-url"];

  // Project-level config (kitn.json)
  if (chatServiceConfig?.url) return chatServiceConfig.url;

  return DEFAULT_SERVICE_URL;
}

// ---------------------------------------------------------------------------
// Plan formatting
// ---------------------------------------------------------------------------

/**
 * Format a ChatPlan for display using picocolors.
 */
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
// Step execution
// ---------------------------------------------------------------------------

async function executeStep(step: PlanStep): Promise<void> {
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
      const { createCommand } = await import("./create.js");
      await createCommand(step.type!, step.name!);
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
// Tool handlers (exported for testing)
// ---------------------------------------------------------------------------

export async function handleAskUser(input: { items: AskUserItem[] }): Promise<string> {
  const responses: string[] = [];
  for (const item of input.items) {
    switch (item.type) {
      case "info":
        p.log.info(item.text);
        break;
      case "warning":
        p.log.warn(item.text);
        break;
      case "confirmation": {
        const confirmed = await p.confirm({ message: item.text });
        if (p.isCancel(confirmed)) return "User cancelled.";
        responses.push(confirmed ? "Yes" : "No");
        break;
      }
      case "option": {
        if (!item.choices?.length) { responses.push("No choices provided."); break; }
        const selected = await p.select({
          message: item.text,
          options: item.choices.map((c) => ({ value: c, label: c })),
        });
        if (p.isCancel(selected)) return "User cancelled.";
        responses.push(`User selected: ${selected}`);
        break;
      }
      case "question": {
        const answer = await p.text({ message: item.text, placeholder: item.context });
        if (p.isCancel(answer)) return "User cancelled.";
        responses.push(`User answered: ${answer}`);
        break;
      }
    }
  }
  return responses.join("\n");
}

/**
 * Validate plan steps against registry and installed components.
 * Returns error messages for invalid steps, or empty array if all valid.
 */
export function validatePlan(
  plan: ChatPlan,
  availableComponents: string[],
  installedComponents: string[],
): string[] {
  const errors: string[] = [];
  const availableSet = new Set(availableComponents);
  const installedSet = new Set(installedComponents);

  // Collect names being added/created in this plan for forward-reference checks
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

export async function handleCreatePlan(
  plan: ChatPlan,
  cwd: string,
  availableComponents?: string[],
  installedComponents?: string[],
): Promise<string> {
  // Validate plan if context is available
  if (availableComponents && installedComponents) {
    const errors = validatePlan(plan, availableComponents, installedComponents);
    if (errors.length > 0) {
      p.log.warn("Plan has issues:");
      for (const err of errors) p.log.error(err);
      return `PLAN VALIDATION FAILED. Fix these issues and call createPlan again:\n${errors.join("\n")}`;
    }
  }

  p.log.message(formatPlan(plan));
  const steps = plan.steps;
  let selectedSteps: PlanStep[];

  if (steps.length === 1) {
    const confirm = await p.confirm({ message: `Run: ${formatStepLabel(steps[0])}?` });
    if (p.isCancel(confirm) || !confirm) return "User cancelled the plan.";
    selectedSteps = steps;
  } else {
    const action = await p.select({
      message: "How would you like to proceed?",
      options: [
        { value: "all", label: "Yes, run all steps" },
        { value: "select", label: "Select which steps to run" },
        { value: "cancel", label: "Cancel" },
      ],
    });
    if (p.isCancel(action) || action === "cancel") return "User cancelled the plan.";
    if (action === "select") {
      const choices = await p.multiselect({
        message: "Select steps to run:",
        options: steps.map((step, i) => ({ value: i, label: `${formatStepLabel(step)} - ${step.reason}` })),
      });
      if (p.isCancel(choices)) return "User cancelled the plan.";
      selectedSteps = (choices as number[]).map((i) => steps[i]);
    } else {
      selectedSteps = steps;
    }
  }

  const results: string[] = [];
  const s = p.spinner();
  for (const step of selectedSteps) {
    s.start(`Running: ${formatStepLabel(step)}...`);
    try {
      await executeStep(step);
      s.stop(pc.green(`Done: ${formatStepLabel(step)}`));
      results.push(`Completed: ${step.action} ${step.component ?? step.name ?? ""}`);
    } catch (err: any) {
      s.stop(pc.red(`Failed: ${formatStepLabel(step)}`));
      results.push(`Failed: ${step.action} ${step.component ?? step.name ?? ""} — ${err.message}`);
    }
  }
  return results.join("\n");
}

// ---------------------------------------------------------------------------
// File operation handlers (exported for testing)
// ---------------------------------------------------------------------------

export async function handleWriteFile(input: WriteFileInput, cwd: string): Promise<string> {
  const fullPath = resolve(cwd, input.path);
  if (!fullPath.startsWith(resolve(cwd))) {
    return `Rejected: path '${input.path}' would escape project directory`;
  }
  await mkdir(dirname(fullPath), { recursive: true });
  await fsWriteFile(fullPath, input.content, "utf-8");
  p.log.success(`Wrote ${pc.cyan(input.path)}${input.description ? ` — ${input.description}` : ""}`);
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
      // Support *.ext patterns
      if (pattern.startsWith("*.")) {
        return name.endsWith(pattern.slice(1));
      }
      // Support **/*.ext patterns
      if (pattern.startsWith("**/") && pattern.includes("*.")) {
        const ext = pattern.slice(pattern.lastIndexOf("*.") + 1);
        return name.endsWith(ext);
      }
      // Support directory/*.ext patterns
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

export async function handleUpdateEnv(input: UpdateEnvInput, cwd: string): Promise<string> {
  const value = await p.password({ message: `Enter ${input.key} (${input.description}):` });
  if (p.isCancel(value) || !value) return "User cancelled.";
  return handleUpdateEnvDirect(input, cwd, value);
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
  p.log.success(`Set ${pc.cyan(input.key)} in .env`);
  return `Successfully set ${input.key} in .env`;
}

// ---------------------------------------------------------------------------
// Tool call dispatcher
// ---------------------------------------------------------------------------

interface ToolCallContext {
  cwd: string;
  availableComponents: string[];
  installedComponents: string[];
}

async function handleToolCalls(toolCalls: ToolCall[], ctx: ToolCallContext): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of toolCalls) {
    let result: string;
    const input = call.input ?? {};
    try {
      switch (call.name) {
        case "askUser":
          result = await handleAskUser({ items: (input as any).items ?? [] });
          break;
        case "createPlan":
          result = await handleCreatePlan(input as ChatPlan, ctx.cwd, ctx.availableComponents, ctx.installedComponents);
          break;
        case "writeFile":
          result = await handleWriteFile(input as WriteFileInput, ctx.cwd);
          break;
        case "readFile":
          result = await handleReadFile(input as ReadFileInput, ctx.cwd);
          break;
        case "listFiles":
          result = await handleListFiles(input as ListFilesInput, ctx.cwd);
          break;
        case "updateEnv":
          result = await handleUpdateEnv(input as UpdateEnvInput, ctx.cwd);
          break;
        default:
          result = `Unknown tool: ${call.name}`;
      }
    } catch (err: any) {
      result = `Error executing ${call.name}: ${err.message ?? "Unknown error"}`;
    }
    results.push({ toolCallId: call.id, toolName: call.name, result });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

async function compactConversation(messages: ChatMessage[], serviceUrl: string): Promise<void> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.KITN_API_KEY) headers["Authorization"] = `Bearer ${process.env.KITN_API_KEY}`;

    const res = await fetch(`${serviceUrl}/api/chat/compact`, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages }),
    });

    if (res.ok) {
      const data = await res.json() as { summary: string };
      const compacted = applyCompaction(messages, data.summary);
      messages.length = 0;
      messages.push(...compacted);
    }
  } catch {
    // Compaction is best-effort; if it fails, continue with full history
  }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function chatCommand(message: string | undefined, opts?: { url?: string; model?: string }): Promise<void> {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  p.intro(pc.bold("kitn assistant"));

  // If no message, prompt for one
  if (!message) {
    const input = await p.text({
      message: "What would you like to do?",
      placeholder: "e.g., I want to build a weather agent",
    });
    if (p.isCancel(input) || !input) { p.cancel("Cancelled."); return; }
    message = input;
  }

  // Gather project context
  const s = p.spinner();
  s.start("Gathering project context...");

  let registryIndex: unknown;
  let installed: string[];
  let globalRegistryIndex: GlobalRegistryEntry[] | undefined;

  try {
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
    registryIndex = indices
      .filter(Boolean)
      .flatMap((index: any) => (index.items ?? []).map((item: any) => ({
        name: item.name,
        type: item.type,
        description: item.description,
        registryDependencies: item.registryDependencies,
      })));
    // Read installed from kitn.lock (preferred) or kitn.json installed key (legacy)
    const lockKeys = Object.keys(lock);
    const configInstalledKeys = rawConfig?.installed ? Object.keys(rawConfig.installed) : [];
    installed = lockKeys.length > 0 ? lockKeys : configInstalledKeys;
    globalRegistryIndex = globalEntries.length > 0 ? globalEntries : undefined;
  } catch {
    s.stop(pc.red("Failed to gather context"));
    p.log.error("Could not read project context.");
    process.exit(1);
  }
  s.stop("Context gathered");

  // Initialize conversation
  const messages: ChatMessage[] = [{ role: "user", content: message }];
  const serviceUrl = await resolveServiceUrl(opts?.url, config.chatService);
  const metadata: Record<string, unknown> = { registryIndex, installed };
  if (globalRegistryIndex) metadata.globalRegistryIndex = globalRegistryIndex;
  const requestModel = opts?.model;

  // Build available component names for plan validation
  const availableComponents = (registryIndex as any[]).map((item: any) => item.name);
  const toolCallCtx: ToolCallContext = { cwd, availableComponents, installedComponents: installed };

  let totalTokens = 0;
  let lastInputTokens = 0;
  const sessionStart = Date.now();
  const MAX_PROMPT_TOKENS = 100_000;

  // Agentic loop
  while (true) {
    const turnStart = Date.now();

    // Check for compaction — use last turn's input tokens (represents full context size)
    if (shouldCompact(lastInputTokens, MAX_PROMPT_TOKENS)) {
      s.start("Compacting conversation...");
      await compactConversation(messages, serviceUrl);
      s.stop(pc.dim("Conversation compacted."));
    }

    s.start("Thinking...");

    // Call service
    let response: ChatServiceResponse;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.KITN_API_KEY) headers["Authorization"] = `Bearer ${process.env.KITN_API_KEY}`;

      const res = await fetch(`${serviceUrl}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildServicePayload(messages, metadata, requestModel)),
      });

      if (!res.ok) {
        s.stop(pc.red("Request failed"));
        p.log.error(`Chat service returned ${res.status}: ${res.statusText}`);
        break;
      }
      response = await res.json() as ChatServiceResponse;
    } catch (err: any) {
      s.stop(pc.red("Connection failed"));
      p.log.error(`Could not reach chat service at ${serviceUrl}. ${err.message ?? ""}`);
      break;
    }

    const elapsed = Date.now() - turnStart;
    totalTokens += response.usage.outputTokens;
    lastInputTokens = response.usage.inputTokens;

    // Handle rejected
    if ((response as any).rejected) {
      s.stop("Done");
      p.log.warn((response as any).text ?? "Request was rejected.");
      break;
    }

    // If no tool calls — just text, conversation ends
    if (!hasToolCalls(response)) {
      s.stop(`Done ${pc.dim(`(${formatElapsed(elapsed)} | ${formatTokens(response.usage.outputTokens)} tokens)`)}`);
      if (response.message.content) p.log.message(response.message.content);
      break;
    }

    s.stop(`${pc.dim(`(${formatElapsed(elapsed)} | ${formatTokens(response.usage.outputTokens)} tokens)`)}`);

    // Append assistant message to history
    messages.push({
      role: "assistant",
      content: response.message.content,
      toolCalls: response.message.toolCalls,
    });

    // Handle each tool call
    const toolResults = await handleToolCalls(response.message.toolCalls!, toolCallCtx);

    // Append tool results to history
    messages.push({ role: "tool", toolResults });
  }

  const totalElapsed = Date.now() - sessionStart;
  p.outro(pc.green("Done! ") + pc.dim(formatSessionStats(totalElapsed, totalTokens)));
}
