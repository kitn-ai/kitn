import { describe, test, expect } from "bun:test";
import { getNextRun, validateCron } from "../src/crons/cron-parser.js";

describe("validateCron", () => {
  test("valid expressions return null", () => {
    expect(validateCron("* * * * *")).toBeNull();
    expect(validateCron("0 6 * * *")).toBeNull();
    expect(validateCron("0 9 * * 1")).toBeNull();
    expect(validateCron("30 17 * * 5")).toBeNull();
    expect(validateCron("0 0 1 * *")).toBeNull();
    expect(validateCron("*/5 * * * *")).toBeNull();
    expect(validateCron("0 6,12,18 * * *")).toBeNull();
    expect(validateCron("0 9 * * 1-5")).toBeNull();
  });

  test("invalid expressions return error message", () => {
    expect(validateCron("")).not.toBeNull();
    expect(validateCron("* *")).not.toBeNull();
    expect(validateCron("60 * * * *")).not.toBeNull();
    expect(validateCron("* 25 * * *")).not.toBeNull();
    expect(validateCron("* * 32 * *")).not.toBeNull();
    expect(validateCron("* * * 13 *")).not.toBeNull();
    expect(validateCron("* * * * 8")).not.toBeNull();
    expect(validateCron("not a cron")).not.toBeNull();
  });
});

describe("getNextRun", () => {
  test("every minute", () => {
    const after = new Date("2026-02-28T10:30:00Z");
    const next = getNextRun("* * * * *", after);
    expect(next).toEqual(new Date("2026-02-28T10:31:00Z"));
  });

  test("daily at 6am UTC", () => {
    const after = new Date("2026-02-28T07:00:00Z"); // already past 6am
    const next = getNextRun("0 6 * * *", after);
    expect(next).toEqual(new Date("2026-03-01T06:00:00Z")); // next day
  });

  test("every Monday at 9am", () => {
    // 2026-02-28 is a Saturday
    const after = new Date("2026-02-28T10:00:00Z");
    const next = getNextRun("0 9 * * 1", after);
    expect(next).toEqual(new Date("2026-03-02T09:00:00Z")); // Monday
  });

  test("every 5 minutes", () => {
    const after = new Date("2026-02-28T10:03:00Z");
    const next = getNextRun("*/5 * * * *", after);
    expect(next).toEqual(new Date("2026-02-28T10:05:00Z"));
  });

  test("first of month at midnight", () => {
    const after = new Date("2026-02-15T00:00:00Z");
    const next = getNextRun("0 0 1 * *", after);
    expect(next).toEqual(new Date("2026-03-01T00:00:00Z"));
  });

  test("comma-separated hours", () => {
    const after = new Date("2026-02-28T07:00:00Z");
    const next = getNextRun("0 6,12,18 * * *", after);
    expect(next).toEqual(new Date("2026-02-28T12:00:00Z"));
  });

  test("range: weekdays only", () => {
    // Saturday
    const after = new Date("2026-02-28T10:00:00Z");
    const next = getNextRun("0 9 * * 1-5", after);
    expect(next).toEqual(new Date("2026-03-02T09:00:00Z")); // Monday
  });
});
