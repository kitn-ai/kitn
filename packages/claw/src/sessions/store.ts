import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import { join } from "path";
import type {
  ConversationStore,
  Conversation,
  ConversationMessage,
  ConversationSummary,
} from "@kitnai/core";

/**
 * JSONL-based conversation store for KitnClaw sessions.
 *
 * Each conversation is stored as a JSONL file in the sessions directory.
 * Each line is a JSON-serialized ConversationMessage.
 */
export class JsonlSessionStore implements ConversationStore {
  constructor(private dir: string) {}

  private filePath(id: string, scopeId?: string): string {
    const name = scopeId ? `${scopeId}-${id}` : id;
    return join(this.dir, `${name}.jsonl`);
  }

  async get(id: string, scopeId?: string): Promise<Conversation | null> {
    const path = this.filePath(id, scopeId);
    try {
      const content = await readFile(path, "utf-8");
      const messages = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as ConversationMessage);

      const stats = await import("fs/promises").then((fs) => fs.stat(path));
      return {
        id,
        messages,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
      };
    } catch {
      return null;
    }
  }

  async list(scopeId?: string): Promise<ConversationSummary[]> {
    try {
      const files = await readdir(this.dir);
      const summaries: ConversationSummary[] = [];

      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;

        const id = file.replace(".jsonl", "");
        if (scopeId && !id.startsWith(`${scopeId}-`)) continue;

        const path = join(this.dir, file);
        const content = await readFile(path, "utf-8");
        const messageCount = content.split("\n").filter((l) => l.trim()).length;
        const { stat } = await import("fs/promises");
        const stats = await stat(path);

        summaries.push({
          id: scopeId ? id.replace(`${scopeId}-`, "") : id,
          messageCount,
          updatedAt: stats.mtime.toISOString(),
        });
      }

      return summaries;
    } catch {
      return [];
    }
  }

  async create(id: string, scopeId?: string): Promise<Conversation> {
    await mkdir(this.dir, { recursive: true });
    const path = this.filePath(id, scopeId);
    await writeFile(path, "", "utf-8");
    const now = new Date().toISOString();
    return { id, messages: [], createdAt: now, updatedAt: now };
  }

  async append(
    id: string,
    message: ConversationMessage,
    scopeId?: string,
  ): Promise<Conversation> {
    await mkdir(this.dir, { recursive: true });
    const path = this.filePath(id, scopeId);

    const line = JSON.stringify(message) + "\n";

    try {
      const { appendFile } = await import("fs/promises");
      await appendFile(path, line, "utf-8");
    } catch {
      await writeFile(path, line, "utf-8");
    }

    // Return full conversation
    return (await this.get(id, scopeId))!;
  }

  async delete(id: string, scopeId?: string): Promise<boolean> {
    try {
      await unlink(this.filePath(id, scopeId));
      return true;
    } catch {
      return false;
    }
  }

  async clear(id: string, scopeId?: string): Promise<Conversation> {
    const path = this.filePath(id, scopeId);
    await writeFile(path, "", "utf-8");
    const now = new Date().toISOString();
    return { id, messages: [], createdAt: now, updatedAt: now };
  }
}
