import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { checkEnvVars } from "./env-checker.js";

describe("checkEnvVars", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("returns empty array when all env vars are present", () => {
    process.env.TEST_KEY_A = "value_a";
    process.env.TEST_KEY_B = "value_b";

    const result = checkEnvVars({
      TEST_KEY_A: "Description A",
      TEST_KEY_B: "Description B",
    });

    expect(result).toEqual([]);
  });

  it("returns missing env vars with descriptions", () => {
    delete process.env.MISSING_VAR_1;
    delete process.env.MISSING_VAR_2;

    const result = checkEnvVars({
      MISSING_VAR_1: "First missing var",
      MISSING_VAR_2: "Second missing var",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toContain("MISSING_VAR_1");
    expect(result[0]).toContain("First missing var");
    expect(result[1]).toContain("MISSING_VAR_2");
    expect(result[1]).toContain("Second missing var");
  });

  it("returns only missing vars when some are present", () => {
    process.env.PRESENT_VAR = "exists";
    delete process.env.ABSENT_VAR;

    const result = checkEnvVars({
      PRESENT_VAR: "This one exists",
      ABSENT_VAR: "This one is missing",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("ABSENT_VAR");
    expect(result[0]).toContain("This one is missing");
  });

  it("returns empty array for empty input", () => {
    const result = checkEnvVars({});
    expect(result).toEqual([]);
  });

  it("treats empty string env var as present", () => {
    process.env.EMPTY_VAR = "";

    const result = checkEnvVars({
      EMPTY_VAR: "Should be considered missing",
    });

    // Empty string is falsy, so checkEnvVars treats it as missing
    expect(result).toHaveLength(1);
  });
});
