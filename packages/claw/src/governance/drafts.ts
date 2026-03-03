import type { Client } from "@libsql/client";
import { randomUUID } from "crypto";

export interface DraftEntry {
  id: string;
  action: string;
  toolName: string;
  input: Record<string, unknown>;
  preview: string;
  sessionId: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export class DraftQueue {
  private db: Client;
  private initialized = false;

  constructor(db: Client) {
    this.db = db;
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        preview TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status)
    `);
    this.initialized = true;
  }

  async create(params: {
    action: string;
    toolName: string;
    input: Record<string, unknown>;
    preview: string;
    sessionId: string;
  }): Promise<DraftEntry> {
    await this.ensureTable();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await this.db.execute({
      sql: "INSERT INTO drafts (id, action, tool_name, input, preview, session_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      args: [id, params.action, params.toolName, JSON.stringify(params.input), params.preview, params.sessionId, createdAt],
    });
    return { id, ...params, status: "pending", createdAt };
  }

  async get(id: string): Promise<DraftEntry | null> {
    await this.ensureTable();
    const result = await this.db.execute({ sql: "SELECT * FROM drafts WHERE id = ?", args: [id] });
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      action: String(row.action),
      toolName: String(row.tool_name),
      input: JSON.parse(String(row.input)),
      preview: String(row.preview),
      sessionId: String(row.session_id),
      status: String(row.status) as DraftEntry["status"],
      createdAt: String(row.created_at),
    };
  }

  async listPending(): Promise<DraftEntry[]> {
    await this.ensureTable();
    const result = await this.db.execute("SELECT * FROM drafts WHERE status = 'pending' ORDER BY created_at ASC");
    return result.rows.map((row) => ({
      id: String(row.id),
      action: String(row.action),
      toolName: String(row.tool_name),
      input: JSON.parse(String(row.input)),
      preview: String(row.preview),
      sessionId: String(row.session_id),
      status: "pending" as const,
      createdAt: String(row.created_at),
    }));
  }

  async approve(id: string): Promise<DraftEntry | null> {
    await this.ensureTable();
    await this.db.execute({ sql: "UPDATE drafts SET status = 'approved' WHERE id = ?", args: [id] });
    return this.get(id);
  }

  async reject(id: string): Promise<void> {
    await this.ensureTable();
    await this.db.execute({ sql: "UPDATE drafts SET status = 'rejected' WHERE id = ?", args: [id] });
  }
}
