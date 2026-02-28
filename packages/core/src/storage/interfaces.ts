// ── Conversation Store ──

/** A single message within a conversation */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** Optional metadata (e.g. cards, tool results) attached to this message */
  metadata?: Record<string, unknown>;
}

/** Full conversation record including all messages */
export interface Conversation {
  id: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Lightweight conversation summary for listing */
export interface ConversationSummary {
  id: string;
  messageCount: number;
  updatedAt: string;
}

/**
 * Stores and retrieves multi-turn conversations.
 *
 * Implementations should auto-create conversations on first `append()` if they don't exist.
 * Return `null` from `get()` when a conversation is not found (do not throw).
 *
 * @example
 * ```ts
 * class PostgresConversationStore implements ConversationStore {
 *   async get(id: string) {
 *     const row = await db.query("SELECT * FROM conversations WHERE id = $1", [id]);
 *     return row ? deserialize(row) : null;
 *   }
 *   async append(id: string, message: ConversationMessage) {
 *     // Upsert conversation, then append message
 *   }
 *   // ...
 * }
 * ```
 */
export interface ConversationStore {
  /** Get a conversation by ID. Returns `null` if not found. */
  get(id: string, scopeId?: string): Promise<Conversation | null>;
  /** List all conversations as lightweight summaries. When scopeId is provided, only scoped conversations are returned. */
  list(scopeId?: string): Promise<ConversationSummary[]>;
  /** Create a new empty conversation with the given ID. */
  create(id: string, scopeId?: string): Promise<Conversation>;
  /** Append a message to a conversation, creating it if necessary. */
  append(id: string, message: ConversationMessage, scopeId?: string): Promise<Conversation>;
  /** Delete a conversation by ID. Returns `true` if it existed. */
  delete(id: string, scopeId?: string): Promise<boolean>;
  /** Clear all messages from a conversation, keeping the record. */
  clear(id: string, scopeId?: string): Promise<Conversation>;
}

// ── Memory Store ──

/** A single key-value memory entry within a namespace */
export interface MemoryEntry {
  key: string;
  value: string;
  context: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Namespaced key-value store for agent memory.
 *
 * Namespaces are created implicitly when the first entry is saved.
 * Return `null` from `getEntry()` when a key is not found (do not throw).
 * `loadMemoriesForIds()` aggregates entries across multiple namespaces for context injection.
 */
export interface MemoryStore {
  /** List all namespace IDs that contain at least one entry. When scopeId is provided, only scoped namespaces are returned. */
  listNamespaces(scopeId?: string): Promise<string[]>;
  /** List all entries within a namespace. Returns empty array if namespace doesn't exist. When scopeId is provided, only scoped entries are returned. */
  listEntries(namespaceId: string, scopeId?: string): Promise<MemoryEntry[]>;
  /** Create or update a memory entry. The namespace is created implicitly. */
  saveEntry(namespaceId: string, key: string, value: string, context?: string, scopeId?: string): Promise<MemoryEntry>;
  /** Get a single entry by namespace + key. Returns `null` if not found. */
  getEntry(namespaceId: string, key: string, scopeId?: string): Promise<MemoryEntry | null>;
  /** Delete a single entry. Returns `true` if it existed. */
  deleteEntry(namespaceId: string, key: string, scopeId?: string): Promise<boolean>;
  /** Remove all entries in a namespace. */
  clearNamespace(namespaceId: string, scopeId?: string): Promise<void>;
  /** Load entries from multiple namespaces at once, tagged with their namespace. */
  loadMemoriesForIds(ids: string[], scopeId?: string): Promise<Array<MemoryEntry & { namespace: string }>>;
}

// ── Skill Store ──

/** Phase determines when a skill's instructions are injected */
export type SkillPhase = "query" | "response" | "both";

/** Lightweight skill metadata for listing */
export interface SkillMeta {
  name: string;
  description: string;
  tags: string[];
  phase: SkillPhase;
}

/** Full skill record including parsed content */
export interface Skill extends SkillMeta {
  /** Parsed content body (frontmatter removed) */
  content: string;
  /** Original raw content including frontmatter */
  rawContent: string;
  updatedAt: string;
}

/**
 * Stores behavioral skill definitions with YAML frontmatter.
 *
 * Skills are markdown documents with frontmatter containing `name`, `description`,
 * `tags`, and `phase`. The store is responsible for parsing frontmatter on create/update.
 * Return `null` from `getSkill()` when not found (do not throw).
 * `getSkillSummaries()` returns a formatted string suitable for injection into system prompts.
 */
export interface SkillStore {
  /** List all skills as lightweight metadata. */
  listSkills(): Promise<SkillMeta[]>;
  /** Get a skill by name. Returns `null` if not found. */
  getSkill(name: string): Promise<Skill | null>;
  /** Create a new skill from raw markdown content (including frontmatter). */
  createSkill(name: string, content: string): Promise<Skill>;
  /** Update an existing skill's content. */
  updateSkill(name: string, content: string): Promise<Skill>;
  /** Delete a skill by name. Returns `true` if it existed. */
  deleteSkill(name: string): Promise<boolean>;
  /** Get a formatted summary of all skills, suitable for system prompt injection. */
  getSkillSummaries(): Promise<string>;
}

// ── Task Store ──

/** A simple task record for tracking work items */
export interface Task {
  id: string;
  title: string;
  status: "todo" | "in-progress" | "done";
  createdAt: string;
  updatedAt: string;
}

/**
 * Simple task/todo store for tracking work items.
 *
 * Tasks have three statuses: `todo`, `in-progress`, `done`.
 */
export interface TaskStore {
  /** Create a new task with status `todo`. */
  createTask(title: string): Promise<Task>;
  /** List all tasks. */
  listTasks(): Promise<Task[]>;
  /** Update a task's title and/or status. */
  updateTask(id: string, updates: { title?: string; status?: "todo" | "in-progress" | "done" }): Promise<Task>;
  /** Delete a task by ID. Returns `true` if it existed. */
  deleteTask(id: string): Promise<boolean>;
}

// ── Prompt Store ──

/** A stored system prompt override for an agent */
export interface PromptOverride {
  prompt: string;
  updatedAt: string;
}

/**
 * Persists system prompt overrides for agents.
 *
 * When an agent's prompt is customized at runtime, it is saved here and
 * lazy-loaded on first agent access to restore overrides across restarts.
 */
export interface PromptStore {
  /** Load all stored prompt overrides, keyed by agent name. */
  loadOverrides(): Promise<Record<string, PromptOverride>>;
  /** Save or update a prompt override for an agent. */
  saveOverride(name: string, prompt: string): Promise<PromptOverride>;
  /** Remove a prompt override. Returns `true` if it existed. */
  deleteOverride(name: string): Promise<boolean>;
}

// ── Command Store ──

/** A registered command definition for the command execution system */
export interface CommandRegistration {
  name: string;
  description: string;
  system: string;
  tools?: string[];
  model?: string;
  format?: "json" | "sse";
}

/**
 * Stores and retrieves command registrations.
 *
 * Commands are named configurations that pair a system prompt with tools
 * and model settings. All methods accept an optional `scopeId` for
 * multi-tenant scoping — when omitted, commands are stored in the global scope.
 */
export interface CommandStore {
  /** List all commands in the given scope (or global scope when omitted). */
  list(scopeId?: string): Promise<CommandRegistration[]>;
  /** Get a command by name within the given scope. Returns `undefined` if not found. */
  get(name: string, scopeId?: string): Promise<CommandRegistration | undefined>;
  /** Save (create or overwrite) a command in the given scope. */
  save(command: CommandRegistration, scopeId?: string): Promise<void>;
  /** Delete a command by name within the given scope. */
  delete(name: string, scopeId?: string): Promise<void>;
}

// ── Cron Store ──

/** A scheduled job definition — recurring (cron expression) or one-off (specific datetime) */
export interface CronJob {
  id: string;
  name: string;
  description: string;

  /** Cron expression for recurring jobs: "0 6 * * *" (mutually exclusive with runAt) */
  schedule?: string;
  /** ISO datetime for one-off jobs: "2026-03-07T17:00:00Z" (mutually exclusive with schedule) */
  runAt?: string;

  /** Name of the registered agent to invoke */
  agentName: string;
  /** Input message sent to the agent */
  input: string;
  /** Optional model override */
  model?: string;
  /** Timezone for schedule evaluation (IANA, e.g. "America/New_York"). Default: UTC */
  timezone?: string;

  enabled: boolean;

  /** ISO datetime of the next scheduled run (computed from schedule or runAt) */
  nextRun?: string;
  /** ISO datetime of the last completed run */
  lastRun?: string;

  createdAt: string;
  updatedAt: string;
}

/** A single execution record for a cron job */
export interface CronExecution {
  id: string;
  cronId: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  /** Brief result summary */
  summary?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Stores cron job definitions and execution history.
 *
 * Jobs can be recurring (with a `schedule` cron expression) or one-off (with a `runAt` datetime).
 * All methods accept an optional `scopeId` for multi-tenant scoping.
 * Return `null` from `get()` when not found (do not throw).
 */
export interface CronStore {
  /** Create a new cron job. */
  create(input: Omit<CronJob, "id" | "createdAt" | "updatedAt">, scopeId?: string): Promise<CronJob>;
  /** Get a cron job by ID. Returns `null` if not found. */
  get(id: string, scopeId?: string): Promise<CronJob | null>;
  /** List all cron jobs. */
  list(scopeId?: string): Promise<CronJob[]>;
  /** Update a cron job. Returns the updated job. */
  update(id: string, updates: Partial<Omit<CronJob, "id" | "createdAt">>, scopeId?: string): Promise<CronJob>;
  /** Delete a cron job. Returns `true` if it existed. */
  delete(id: string, scopeId?: string): Promise<boolean>;

  /** Record an execution start/result. */
  addExecution(input: Omit<CronExecution, "id">, scopeId?: string): Promise<CronExecution>;
  /** List executions for a cron job, newest first. */
  listExecutions(cronId: string, limit?: number, scopeId?: string): Promise<CronExecution[]>;
  /** Update an execution record (e.g. mark completed). */
  updateExecution(id: string, updates: Partial<Omit<CronExecution, "id" | "cronId">>, scopeId?: string): Promise<CronExecution>;

  /** Get all enabled jobs that are due to run (nextRun <= now, or runAt <= now for one-offs that haven't run). */
  getDueJobs(now: Date, scopeId?: string): Promise<CronJob[]>;
}

// ── Job Store ──

/** A background job execution record */
export interface Job {
  id: string;
  agentName: string;
  input: string;
  conversationId: string;
  scopeId?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  toolsUsed?: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Stores and retrieves background job records.
 *
 * Jobs represent asynchronous agent invocations that run in the background.
 * Return `null` from `get()` when not found (do not throw).
 */
export interface JobStore {
  /** Create a new job. */
  create(job: Omit<Job, "id" | "createdAt">): Promise<Job>;
  /** Get a job by ID. Returns `null` if not found. */
  get(id: string, scopeId?: string): Promise<Job | null>;
  /** List all jobs. */
  list(scopeId?: string): Promise<Job[]>;
  /** Update a job. Returns the updated job. */
  update(id: string, updates: Partial<Omit<Job, "id">>): Promise<Job>;
  /** Delete a job. Returns `true` if it existed. */
  delete(id: string, scopeId?: string): Promise<boolean>;
}

// ── Combined Storage Provider ──

/**
 * Aggregates all sub-stores into a single provider.
 *
 * Pass an implementation of this interface to `createAIPlugin({ storage })`.
 * Use `createFileStorage()` for a ready-made file-based implementation,
 * or implement each sub-store to back onto your own database.
 *
 * @example
 * ```ts
 * const storage: StorageProvider = {
 *   conversations: new PostgresConversationStore(db),
 *   memory: new PostgresMemoryStore(db),
 *   skills: new PostgresSkillStore(db),
 *   tasks: new PostgresTaskStore(db),
 *   prompts: new PostgresPromptStore(db),
 * };
 * const plugin = createAIPlugin({ model, storage });
 * ```
 */
export interface StorageProvider {
  conversations: ConversationStore;
  memory: MemoryStore;
  skills: SkillStore;
  tasks: TaskStore;
  prompts: PromptStore;
  commands: CommandStore;
  crons: CronStore;
  jobs: JobStore;
}
