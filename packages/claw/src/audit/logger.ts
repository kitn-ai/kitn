import type { Client } from "@libsql/client";

export interface AuditEntry {
  event: string;
  toolName?: string;
  input?: Record<string, unknown>;
  decision?: string;
  reason?: string;
  sessionId?: string;
  channelType?: string;
  duration?: number;
  [key: string]: unknown;
}

export class AuditLogger {
  private db: Client;
  private initialized = false;

  constructor(db: Client) {
    this.db = db;
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        tool_name TEXT,
        input TEXT,
        decision TEXT,
        reason TEXT,
        session_id TEXT,
        channel_type TEXT,
        duration REAL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event, created_at)
    `);
    this.initialized = true;
  }

  async log(entry: AuditEntry): Promise<void> {
    await this.ensureTable();
    const {
      event,
      toolName,
      input,
      decision,
      reason,
      sessionId,
      channelType,
      duration,
      ...rest
    } = entry;
    await this.db.execute({
      sql: `INSERT INTO audit_log (event, tool_name, input, decision, reason, session_id, channel_type, duration, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        event,
        toolName ?? null,
        input ? JSON.stringify(input) : null,
        decision ?? null,
        reason ?? null,
        sessionId ?? null,
        channelType ?? null,
        duration ?? null,
        Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
      ],
    });
  }

  async query(filters: {
    event?: string;
    toolName?: string;
    sessionId?: string;
    limit?: number;
  }): Promise<AuditEntry[]> {
    await this.ensureTable();
    const conditions: string[] = [];
    const args: unknown[] = [];

    if (filters.event) {
      conditions.push("event = ?");
      args.push(filters.event);
    }
    if (filters.toolName) {
      conditions.push("tool_name = ?");
      args.push(filters.toolName);
    }
    if (filters.sessionId) {
      conditions.push("session_id = ?");
      args.push(filters.sessionId);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit ?? 100;

    const result = await this.db.execute({
      sql: `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`,
      args: [...args, limit],
    });

    return result.rows.map((row) => ({
      event: String(row.event),
      toolName: row.tool_name ? String(row.tool_name) : undefined,
      input: row.input ? JSON.parse(String(row.input)) : undefined,
      decision: row.decision ? String(row.decision) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
      sessionId: row.session_id ? String(row.session_id) : undefined,
      channelType: row.channel_type ? String(row.channel_type) : undefined,
      duration: row.duration != null ? Number(row.duration) : undefined,
    }));
  }
}
