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
 * loaded during `plugin.initialize()` to restore overrides across restarts.
 */
export interface PromptStore {
  /** Load all stored prompt overrides, keyed by agent name. */
  loadOverrides(): Promise<Record<string, PromptOverride>>;
  /** Save or update a prompt override for an agent. */
  saveOverride(name: string, prompt: string): Promise<PromptOverride>;
  /** Remove a prompt override. Returns `true` if it existed. */
  deleteOverride(name: string): Promise<boolean>;
}

// ── Audio Store ──

/** Metadata for a stored audio file */
export interface AudioEntry {
  id: string;
  mimeType: string;
  size: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Stores and retrieves audio files for the voice subsystem.
 *
 * Audio entries are identified by auto-generated IDs. Return `null` from
 * `getAudio()` when not found (do not throw).
 * `cleanupOlderThan()` removes entries older than the given age for garbage collection.
 */
export interface AudioStore {
  /** Save an audio buffer and return its entry metadata. */
  saveAudio(buffer: Buffer | Uint8Array, mimeType: string, metadata?: Record<string, unknown>, scopeId?: string): Promise<AudioEntry>;
  /** Retrieve an audio file by ID. Returns `null` if not found. */
  getAudio(id: string, scopeId?: string): Promise<{ entry: AudioEntry; data: Buffer } | null>;
  /** Delete an audio file by ID. Returns `true` if it existed. */
  deleteAudio(id: string, scopeId?: string): Promise<boolean>;
  /** List all stored audio entries. When scopeId is provided, only scoped entries are returned. */
  listAudio(scopeId?: string): Promise<AudioEntry[]>;
  /** Remove audio entries older than `maxAgeMs` milliseconds. Returns count of deleted entries. */
  cleanupOlderThan(maxAgeMs: number, scopeId?: string): Promise<number>;
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
 *   audio: new S3AudioStore(bucket),
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
  audio: AudioStore;
  commands: CommandStore;
}
