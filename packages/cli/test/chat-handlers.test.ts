import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("handleWriteFile", () => {
  let tempDir: string;
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "kitn-chat-test-")); });
  afterEach(async () => { await rm(tempDir, { recursive: true }); });

  test("writes file content to project directory", async () => {
    const { handleWriteFile } = await import("../src/commands/chat.js");
    const result = await handleWriteFile({ path: "src/test.ts", content: "export const x = 1;" }, tempDir);
    expect(result).toContain("Wrote");
    const content = await readFile(join(tempDir, "src/test.ts"), "utf-8");
    expect(content).toBe("export const x = 1;");
  });

  test("creates nested directories", async () => {
    const { handleWriteFile } = await import("../src/commands/chat.js");
    await handleWriteFile({ path: "a/b/c/test.ts", content: "hello" }, tempDir);
    const content = await readFile(join(tempDir, "a/b/c/test.ts"), "utf-8");
    expect(content).toBe("hello");
  });
});

describe("handleReadFile", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kitn-chat-test-"));
    await writeFile(join(tempDir, "existing.ts"), "const y = 2;");
  });
  afterEach(async () => { await rm(tempDir, { recursive: true }); });

  test("reads existing file", async () => {
    const { handleReadFile } = await import("../src/commands/chat.js");
    const result = await handleReadFile({ path: "existing.ts" }, tempDir);
    expect(result).toContain("const y = 2;");
  });

  test("returns error for missing file", async () => {
    const { handleReadFile } = await import("../src/commands/chat.js");
    const result = await handleReadFile({ path: "missing.ts" }, tempDir);
    expect(result).toContain("not found");
  });
});

describe("handleListFiles", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kitn-chat-test-"));
    await mkdir(join(tempDir, "src/agents"), { recursive: true });
    await writeFile(join(tempDir, "src/agents/a.ts"), "");
    await writeFile(join(tempDir, "src/agents/b.ts"), "");
    await writeFile(join(tempDir, "src/index.ts"), "");
  });
  afterEach(async () => { await rm(tempDir, { recursive: true }); });

  test("lists files matching pattern", async () => {
    const { handleListFiles } = await import("../src/commands/chat.js");
    const result = await handleListFiles({ pattern: "*.ts", directory: "src/agents" }, tempDir);
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
  });
});

describe("handleUpdateEnvDirect", () => {
  let tempDir: string;
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "kitn-chat-test-")); });
  afterEach(async () => { await rm(tempDir, { recursive: true }); });

  test("result never contains the actual value", async () => {
    const { handleUpdateEnvDirect } = await import("../src/commands/chat.js");
    const result = await handleUpdateEnvDirect({ key: "TEST_KEY", description: "A test key" }, tempDir, "secret-value-123");
    expect(result).toContain("TEST_KEY");
    expect(result).not.toContain("secret-value-123");
    const envContent = await readFile(join(tempDir, ".env"), "utf-8");
    expect(envContent).toContain("TEST_KEY=secret-value-123");
  });

  test("appends to existing .env", async () => {
    await writeFile(join(tempDir, ".env"), "EXISTING=value\n");
    const { handleUpdateEnvDirect } = await import("../src/commands/chat.js");
    await handleUpdateEnvDirect({ key: "NEW_KEY", description: "A new key" }, tempDir, "new-value");
    const envContent = await readFile(join(tempDir, ".env"), "utf-8");
    expect(envContent).toContain("EXISTING=value");
    expect(envContent).toContain("NEW_KEY=new-value");
  });
});
