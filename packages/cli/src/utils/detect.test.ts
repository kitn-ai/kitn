import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { detectPackageManager } from "./detect.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("detectPackageManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kitn-detect-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("detects bun from bun.lock", async () => {
    await writeFile(join(tempDir, "bun.lock"), "");
    expect(await detectPackageManager(tempDir)).toBe("bun");
  });

  it("detects bun from bun.lockb", async () => {
    await writeFile(join(tempDir, "bun.lockb"), "");
    expect(await detectPackageManager(tempDir)).toBe("bun");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    await writeFile(join(tempDir, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(tempDir)).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", async () => {
    await writeFile(join(tempDir, "yarn.lock"), "");
    expect(await detectPackageManager(tempDir)).toBe("yarn");
  });

  it("detects npm from package-lock.json", async () => {
    await writeFile(join(tempDir, "package-lock.json"), "{}");
    expect(await detectPackageManager(tempDir)).toBe("npm");
  });

  it("returns null when no lockfile found", async () => {
    expect(await detectPackageManager(tempDir)).toBeNull();
  });
});
