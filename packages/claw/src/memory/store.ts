import { createClient, type Client } from "@libsql/client";
import type { MemoryStore, MemoryEntry } from "@kitnai/core";

/**
 * libSQL-backed memory store for KitnClaw.
 *
 * Uses FTS5 full-text search for keyword matching.
 * Vector search can be added later when an embedding provider is configured.
 */
export class LibsqlMemoryStore implements MemoryStore {
  private client: Client;
  private initialized = false;

  constructor(dbPath: string) {
    this.client = createClient({ url: `file:${dbPath}` });
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    await this.client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS memories (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '',
        scope_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (namespace, key, scope_id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        key, value, context,
        content='memories',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, key, value, context) VALUES (new.rowid, new.key, new.value, new.context);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, value, context) VALUES ('delete', old.rowid, old.key, old.value, old.context);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, value, context) VALUES ('delete', old.rowid, old.key, old.value, old.context);
        INSERT INTO memories_fts(rowid, key, value, context) VALUES (new.rowid, new.key, new.value, new.context);
      END;
    `);
    this.initialized = true;
  }

  private scope(scopeId?: string): string {
    return scopeId ?? "";
  }

  async listNamespaces(scopeId?: string): Promise<string[]> {
    await this.init();
    const result = await this.client.execute({
      sql: "SELECT DISTINCT namespace FROM memories WHERE scope_id = ?",
      args: [this.scope(scopeId)],
    });
    return result.rows.map((r) => r.namespace as string);
  }

  async listEntries(namespaceId: string, scopeId?: string): Promise<MemoryEntry[]> {
    await this.init();
    const result = await this.client.execute({
      sql: "SELECT key, value, context, created_at, updated_at FROM memories WHERE namespace = ? AND scope_id = ? ORDER BY updated_at DESC",
      args: [namespaceId, this.scope(scopeId)],
    });
    return result.rows.map((r) => ({
      key: r.key as string,
      value: r.value as string,
      context: r.context as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  }

  async saveEntry(
    namespaceId: string,
    key: string,
    value: string,
    context?: string,
    scopeId?: string,
  ): Promise<MemoryEntry> {
    await this.init();
    const now = new Date().toISOString();
    await this.client.execute({
      sql: `INSERT INTO memories (namespace, key, value, context, scope_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (namespace, key, scope_id)
            DO UPDATE SET value = excluded.value, context = excluded.context, updated_at = excluded.updated_at`,
      args: [namespaceId, key, value, context ?? "", this.scope(scopeId), now, now],
    });
    return { key, value, context: context ?? "", createdAt: now, updatedAt: now };
  }

  async getEntry(namespaceId: string, key: string, scopeId?: string): Promise<MemoryEntry | null> {
    await this.init();
    const result = await this.client.execute({
      sql: "SELECT key, value, context, created_at, updated_at FROM memories WHERE namespace = ? AND key = ? AND scope_id = ?",
      args: [namespaceId, key, this.scope(scopeId)],
    });
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      key: r.key as string,
      value: r.value as string,
      context: r.context as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  async deleteEntry(namespaceId: string, key: string, scopeId?: string): Promise<boolean> {
    await this.init();
    const result = await this.client.execute({
      sql: "DELETE FROM memories WHERE namespace = ? AND key = ? AND scope_id = ?",
      args: [namespaceId, key, this.scope(scopeId)],
    });
    return result.rowsAffected > 0;
  }

  async clearNamespace(namespaceId: string, scopeId?: string): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: "DELETE FROM memories WHERE namespace = ? AND scope_id = ?",
      args: [namespaceId, this.scope(scopeId)],
    });
  }

  async loadMemoriesForIds(
    ids: string[],
    scopeId?: string,
  ): Promise<Array<MemoryEntry & { namespace: string }>> {
    await this.init();
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(", ");
    const s = this.scope(scopeId);

    const result = await this.client.execute({
      sql: `SELECT namespace, key, value, context, created_at, updated_at
            FROM memories
            WHERE namespace IN (${placeholders}) AND scope_id = ?
            ORDER BY updated_at DESC`,
      args: [...ids, s],
    });

    return result.rows.map((r) => ({
      namespace: r.namespace as string,
      key: r.key as string,
      value: r.value as string,
      context: r.context as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  }

  /**
   * Full-text search across all memories in a namespace.
   * Uses FTS5 for relevance-ranked keyword matching.
   */
  async search(
    namespaceId: string,
    query: string,
    limit = 10,
  ): Promise<MemoryEntry[]> {
    await this.init();
    const result = await this.client.execute({
      sql: `SELECT m.key, m.value, m.context, m.created_at, m.updated_at
            FROM memories_fts fts
            JOIN memories m ON m.rowid = fts.rowid
            WHERE memories_fts MATCH ? AND m.namespace = ?
            ORDER BY rank
            LIMIT ?`,
      args: [query, namespaceId, limit],
    });
    return result.rows.map((r) => ({
      key: r.key as string,
      value: r.value as string,
      context: r.context as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  }

  close(): void {
    this.client.close();
  }
}
