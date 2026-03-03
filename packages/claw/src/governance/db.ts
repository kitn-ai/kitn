import { createClient, type Client } from "@libsql/client";
import { join } from "path";
import { CLAW_HOME } from "../config/io.js";

let _client: Client | null = null;

export interface GovernanceDbOptions {
  dbPath?: string;
  syncUrl?: string;
  authToken?: string;
}

/**
 * Get or create the shared governance database client.
 *
 * Used by BudgetLedger, DraftQueue, AuditLog, etc.
 * Defaults to `~/.kitnclaw/claw.db` if no path is provided.
 */
export function getGovernanceDb(options?: GovernanceDbOptions): Client {
  if (_client) return _client;
  const dbPath = options?.dbPath ?? join(CLAW_HOME, "claw.db");
  _client = createClient({
    url: `file:${dbPath}`,
    ...(options?.syncUrl ? { syncUrl: options.syncUrl, authToken: options.authToken } : {}),
  });
  return _client;
}

/** Reset the cached client (useful for testing). */
export function resetGovernanceDb(): void {
  _client = null;
}
