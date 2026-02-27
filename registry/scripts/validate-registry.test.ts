import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { join } from "path";

const REGISTRY_DIR = join(import.meta.dir, "..");

describe("validate-registry", () => {
  it("passes validation for the current registry", () => {
    const result = execSync("bun run scripts/validate-registry.ts", {
      cwd: REGISTRY_DIR,
      encoding: "utf-8",
    });
    expect(result).toContain("All imports resolve correctly");
  });
});
