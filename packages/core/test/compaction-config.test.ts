import { describe, test, expect } from "bun:test";
import { DEFAULTS } from "../src/utils/constants.js";
import type { CompactionConfig } from "../src/types.js";

describe("CompactionConfig defaults", () => {
  test("has COMPACTION_TOKEN_LIMIT default", () => {
    expect(DEFAULTS.COMPACTION_TOKEN_LIMIT).toBe(80_000);
  });

  test("has COMPACTION_PRESERVE_TOKENS default", () => {
    expect(DEFAULTS.COMPACTION_PRESERVE_TOKENS).toBe(8_000);
  });

  test("no longer has message-count COMPACTION_THRESHOLD", () => {
    expect("COMPACTION_THRESHOLD" in DEFAULTS).toBe(false);
  });

  test("no longer has COMPACTION_PRESERVE_RECENT", () => {
    expect("COMPACTION_PRESERVE_RECENT" in DEFAULTS).toBe(false);
  });

  test("CompactionConfig accepts tokenLimit", () => {
    const config: CompactionConfig = { tokenLimit: 50_000 };
    expect(config.tokenLimit).toBe(50_000);
  });

  test("CompactionConfig accepts preserveTokens", () => {
    const config: CompactionConfig = { preserveTokens: 4_000 };
    expect(config.preserveTokens).toBe(4_000);
  });
});
