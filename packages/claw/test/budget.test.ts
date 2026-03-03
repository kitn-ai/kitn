import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { BudgetLedger } from "../src/governance/budget.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-budget-"));
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("BudgetLedger", () => {
  test("allows spending within budget", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
      },
    });
    const result = await ledger.trySpend("amazon.com", 50);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(50);
  });

  test("blocks spending over budget", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
      },
    });
    await ledger.trySpend("amazon.com", 80);
    const result = await ledger.trySpend("amazon.com", 30);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(20);
  });

  test("blocks spending on unlisted domains (default: 0)", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
      },
    });
    const result = await ledger.trySpend("ebay.com", 10);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  test("allows if default budget is set", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        default: { limit: 50, period: "monthly" },
      },
    });
    const result = await ledger.trySpend("some-site.com", 25);
    expect(result.allowed).toBe(true);
  });

  test("tracks cumulative spending", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
      },
    });
    await ledger.trySpend("amazon.com", 30);
    await ledger.trySpend("amazon.com", 40);
    const result = await ledger.trySpend("amazon.com", 20);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });

  test("returns current spending summary", async () => {
    const ledger = new BudgetLedger({
      dbPath: join(tmpDir, "claw.db"),
      budgets: {
        "amazon.com": { limit: 100, period: "monthly" },
        "ebay.com": { limit: 50, period: "monthly" },
      },
    });
    await ledger.trySpend("amazon.com", 30);
    const summary = await ledger.getSummary();
    expect(summary["amazon.com"].spent).toBe(30);
    expect(summary["amazon.com"].limit).toBe(100);
    expect(summary["amazon.com"].remaining).toBe(70);
  });
});
