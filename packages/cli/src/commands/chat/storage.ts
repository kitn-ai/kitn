import { readFile, writeFile, mkdir, unlink, rm } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { estimateChatMessageTokens } from "../chat-engine.js";
import type {
  ChatMessage,
  ConversationEvent,
  ConversationMetaEvent,
  ConversationMessageEvent,
  ConversationCompactionEvent,
  ConversationMeta,
  ConversationIndex,
} from "../chat-types.js";

const CONVERSATIONS_DIR = ".kitn/conversations";
const INDEX_FILE = "index.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateConversationId(): string {
  const ts = Math.floor(Date.now() / 1000);
  const hex = randomBytes(2).toString("hex");
  return `conv_${ts}_${hex}`;
}

function conversationsPath(cwd: string): string {
  return join(cwd, CONVERSATIONS_DIR);
}

function conversationFilePath(cwd: string, id: string): string {
  return join(conversationsPath(cwd), `${id}.jsonl`);
}

function indexPath(cwd: string): string {
  return join(conversationsPath(cwd), INDEX_FILE);
}

export async function ensureConversationsDir(cwd: string): Promise<void> {
  await mkdir(conversationsPath(cwd), { recursive: true });
}

// ---------------------------------------------------------------------------
// Index operations
// ---------------------------------------------------------------------------

export async function readIndex(cwd: string): Promise<ConversationIndex> {
  try {
    const raw = await readFile(indexPath(cwd), "utf-8");
    return JSON.parse(raw) as ConversationIndex;
  } catch {
    return { conversations: [] };
  }
}

async function writeIndex(cwd: string, index: ConversationIndex): Promise<void> {
  await ensureConversationsDir(cwd);
  await writeFile(indexPath(cwd), JSON.stringify(index, null, 2), "utf-8");
}

function updateIndexEntry(index: ConversationIndex, meta: ConversationMeta): ConversationIndex {
  const filtered = index.conversations.filter((c) => c.id !== meta.id);
  return { conversations: [...filtered, meta] };
}

// ---------------------------------------------------------------------------
// Conversation CRUD
// ---------------------------------------------------------------------------

export async function createConversation(cwd: string, title: string): Promise<ConversationMeta> {
  const id = generateConversationId();
  const now = new Date().toISOString();

  await ensureConversationsDir(cwd);

  const metaEvent: ConversationMetaEvent = { type: "meta", id, createdAt: now, title };
  await writeFile(conversationFilePath(cwd, id), JSON.stringify(metaEvent) + "\n", "utf-8");

  const meta: ConversationMeta = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    tokenEstimate: 0,
  };

  const index = await readIndex(cwd);
  await writeIndex(cwd, updateIndexEntry(index, meta));

  return meta;
}

export async function appendMessage(cwd: string, id: string, message: ChatMessage): Promise<void> {
  const event: ConversationMessageEvent = {
    type: "msg",
    role: message.role,
    ...(message.content !== undefined ? { content: message.content } : {}),
    ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
    ...(message.toolResults?.length ? { toolResults: message.toolResults } : {}),
    ts: new Date().toISOString(),
  };

  const filePath = conversationFilePath(cwd, id);
  await writeFile(filePath, JSON.stringify(event) + "\n", { flag: "a" });

  // Update index
  const index = await readIndex(cwd);
  const existing = index.conversations.find((c) => c.id === id);
  if (existing) {
    existing.updatedAt = event.ts;
    existing.messageCount += 1;
    existing.tokenEstimate = estimateChatMessageTokens(rebuildMessages(await readConversationEvents(cwd, id)));
    await writeIndex(cwd, index);
  }
}

export async function appendCompaction(
  cwd: string,
  id: string,
  summary: string,
  summarizedCount: number,
  preservedMessages: ChatMessage[],
): Promise<void> {
  // Read current events to get the meta line
  const events = await readConversationEvents(cwd, id);
  const metaEvent = events.find((e): e is ConversationMetaEvent => e.type === "meta");
  if (!metaEvent) throw new Error(`No meta event found for conversation ${id}`);

  const compactionEvent: ConversationCompactionEvent = {
    type: "compaction",
    summary,
    summarizedCount,
    ts: new Date().toISOString(),
  };

  // Rewrite file: meta + compaction + preserved messages (atomic via temp file)
  const lines: string[] = [JSON.stringify(metaEvent)];
  lines.push(JSON.stringify(compactionEvent));
  for (const msg of preservedMessages) {
    const msgEvent: ConversationMessageEvent = {
      type: "msg",
      role: msg.role,
      ...(msg.content !== undefined ? { content: msg.content } : {}),
      ...(msg.toolCalls?.length ? { toolCalls: msg.toolCalls } : {}),
      ...(msg.toolResults?.length ? { toolResults: msg.toolResults } : {}),
      ts: new Date().toISOString(),
    };
    lines.push(JSON.stringify(msgEvent));
  }

  const filePath = conversationFilePath(cwd, id);
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, lines.join("\n") + "\n", "utf-8");
  const { rename } = await import("fs/promises");
  await rename(tmpPath, filePath);

  // Update index
  const index = await readIndex(cwd);
  const existing = index.conversations.find((c) => c.id === id);
  if (existing) {
    existing.updatedAt = compactionEvent.ts;
    existing.messageCount = preservedMessages.length;
    existing.tokenEstimate = estimateChatMessageTokens(preservedMessages);
    await writeIndex(cwd, index);
  }
}

// ---------------------------------------------------------------------------
// Read & rebuild
// ---------------------------------------------------------------------------

export async function readConversationEvents(cwd: string, id: string): Promise<ConversationEvent[]> {
  try {
    const raw = await readFile(conversationFilePath(cwd, id), "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ConversationEvent);
  } catch {
    return [];
  }
}

export function rebuildMessages(events: ConversationEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const event of events) {
    switch (event.type) {
      case "meta":
        // Skip meta events
        break;
      case "compaction":
        // Compaction becomes a user message with the summary
        messages.push({ role: "user", content: event.summary });
        break;
      case "msg":
        messages.push({
          role: event.role,
          ...(event.content !== undefined ? { content: event.content } : {}),
          ...(event.toolCalls?.length ? { toolCalls: event.toolCalls } : {}),
          ...(event.toolResults?.length ? { toolResults: event.toolResults } : {}),
        });
        break;
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// List, get, delete
// ---------------------------------------------------------------------------

export async function listConversations(cwd: string): Promise<ConversationMeta[]> {
  const index = await readIndex(cwd);
  // Sort by updatedAt descending (most recent first)
  return index.conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getLastConversation(cwd: string): Promise<ConversationMeta | null> {
  const convos = await listConversations(cwd);
  return convos.length > 0 ? convos[0] : null;
}

export async function deleteConversation(cwd: string, id: string): Promise<void> {
  try {
    await unlink(conversationFilePath(cwd, id));
  } catch {
    // File may not exist
  }
  const index = await readIndex(cwd);
  const filtered = index.conversations.filter((c) => c.id !== id);
  await writeIndex(cwd, { conversations: filtered });
}

export async function clearAllConversations(cwd: string): Promise<void> {
  try {
    await rm(conversationsPath(cwd), { recursive: true, force: true });
  } catch {
    // Directory may not exist
  }
}

// ---------------------------------------------------------------------------
// Export conversation to markdown
// ---------------------------------------------------------------------------

export async function exportConversation(cwd: string, id: string): Promise<string> {
  const events = await readConversationEvents(cwd, id);
  const metaEvent = events.find((e): e is ConversationMetaEvent => e.type === "meta");
  const title = metaEvent?.title ?? "Untitled conversation";
  const lines: string[] = [`# ${title}`, ""];

  for (const event of events) {
    if (event.type === "meta") continue;
    if (event.type === "compaction") {
      lines.push(`> **Compacted** (${event.summarizedCount} messages summarized)`, "");
      lines.push(event.summary, "");
      continue;
    }
    if (event.type === "msg") {
      const roleLabel = event.role === "user" ? "**User**" : event.role === "assistant" ? "**Assistant**" : "**Tool**";
      lines.push(`### ${roleLabel}`, "");
      if (event.content) lines.push(event.content, "");
      if (event.toolCalls?.length) {
        for (const tc of event.toolCalls) {
          lines.push(`*Tool call: ${tc.name}*`, "");
        }
      }
      if (event.toolResults?.length) {
        for (const tr of event.toolResults) {
          lines.push(`*Tool result (${tr.toolName}):* ${tr.result.slice(0, 200)}`, "");
        }
      }
    }
  }

  // Write to .kitn/exports/
  const exportDir = join(cwd, ".kitn/exports");
  await mkdir(exportDir, { recursive: true });
  const exportPath = join(exportDir, `${id}.md`);
  const content = lines.join("\n");
  await writeFile(exportPath, content, "utf-8");
  return exportPath;
}
