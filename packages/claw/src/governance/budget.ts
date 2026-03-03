import { createClient, type Client } from "@libsql/client";

export interface BudgetConfig {
  limit: number;
  period: "daily" | "weekly" | "monthly";
}

export interface SpendResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  currentSpend: number;
}

/**
 * libSQL-backed budget ledger for enforcing spending caps per domain/service.
 *
 * Each domain has a configurable limit and period (daily, weekly, monthly).
 * The AI cannot override spending limits — enforcement happens in the tool's
 * execute function before the action is taken.
 *
 * A special "default" key applies to any domain not explicitly listed.
 * If no budget exists for a domain and no default is set, spending is denied.
 */
export class BudgetLedger {
  private db: Client;
  private budgets: Record<string, BudgetConfig>;
  private initialized = false;

  constructor(options: {
    dbPath: string;
    budgets: Record<string, BudgetConfig>;
    syncUrl?: string;
    authToken?: string;
  }) {
    this.db = createClient({
      url: `file:${options.dbPath}`,
      ...(options.syncUrl ? { syncUrl: options.syncUrl, authToken: options.authToken } : {}),
    });
    this.budgets = options.budgets;
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS budget_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_budget_domain_date ON budget_entries(domain, created_at)
    `);
    this.initialized = true;
  }

  private getPeriodStart(period: "daily" | "weekly" | "monthly"): string {
    const now = new Date();
    switch (period) {
      case "daily":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      case "weekly": {
        const day = now.getDay();
        const diff = now.getDate() - day;
        return new Date(now.getFullYear(), now.getMonth(), diff).toISOString();
      }
      case "monthly":
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    }
  }

  private async getCurrentSpend(domain: string, period: "daily" | "weekly" | "monthly"): Promise<number> {
    await this.ensureTable();
    const start = this.getPeriodStart(period);
    const result = await this.db.execute({
      sql: "SELECT COALESCE(SUM(amount), 0) as total FROM budget_entries WHERE domain = ? AND created_at >= ?",
      args: [domain, start],
    });
    return Number(result.rows[0]?.total ?? 0);
  }

  /**
   * Attempt to spend an amount against a domain's budget.
   *
   * If the domain has no explicit budget and no "default" budget exists,
   * spending is denied (zero remaining).
   *
   * If spending would exceed the limit, the transaction is NOT recorded
   * and the result indicates denial with the current remaining amount.
   */
  async trySpend(domain: string, amount: number, description?: string): Promise<SpendResult> {
    await this.ensureTable();
    const budget = this.budgets[domain] ?? this.budgets["default"];
    if (!budget) {
      return { allowed: false, remaining: 0, limit: 0, currentSpend: 0 };
    }

    const currentSpend = await this.getCurrentSpend(domain, budget.period);
    const remaining = budget.limit - currentSpend;

    if (currentSpend + amount > budget.limit) {
      return { allowed: false, remaining, limit: budget.limit, currentSpend };
    }

    await this.db.execute({
      sql: "INSERT INTO budget_entries (domain, amount, description) VALUES (?, ?, ?)",
      args: [domain, amount, description ?? null],
    });

    return {
      allowed: true,
      remaining: remaining - amount,
      limit: budget.limit,
      currentSpend: currentSpend + amount,
    };
  }

  /**
   * Get a summary of spending for all configured domains (excluding "default").
   */
  async getSummary(): Promise<Record<string, { spent: number; limit: number; remaining: number }>> {
    const summary: Record<string, { spent: number; limit: number; remaining: number }> = {};
    for (const [domain, budget] of Object.entries(this.budgets)) {
      if (domain === "default") continue;
      const spent = await this.getCurrentSpend(domain, budget.period);
      summary[domain] = {
        spent,
        limit: budget.limit,
        remaining: budget.limit - spent,
      };
    }
    return summary;
  }
}
