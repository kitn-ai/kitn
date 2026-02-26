import { describe, test, expect } from "bun:test";
import { startUpdateCheck, isNewer } from "../src/utils/update-check.js";

describe("update check", () => {
  test("startUpdateCheck returns a function", () => {
    const print = startUpdateCheck("0.0.1");
    expect(typeof print).toBe("function");
  });

  test("isNewer detects newer major version", () => {
    expect(isNewer("2.0.0", "1.0.0")).toBe(true);
  });

  test("isNewer detects newer minor version", () => {
    expect(isNewer("1.2.0", "1.1.0")).toBe(true);
  });

  test("isNewer detects newer patch version", () => {
    expect(isNewer("1.0.2", "1.0.1")).toBe(true);
  });

  test("isNewer returns false for same version", () => {
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
  });

  test("isNewer returns false for older version", () => {
    expect(isNewer("1.0.0", "2.0.0")).toBe(false);
    expect(isNewer("1.0.0", "1.1.0")).toBe(false);
    expect(isNewer("1.0.0", "1.0.1")).toBe(false);
  });

  test("no notice when version is current", () => {
    const print = startUpdateCheck("999.999.999");
    // Immediately calling — background check hasn't completed, so no output
    let output = "";
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;
    print();
    process.stderr.write = origWrite;
    expect(output).toBe("");
  });
});
