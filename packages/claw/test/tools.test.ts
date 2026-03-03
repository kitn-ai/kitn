import { describe, test, expect } from "bun:test";
import { fileReadTool } from "../src/tools/file-read.js";
import { fileWriteTool } from "../src/tools/file-write.js";
import { fileSearchTool } from "../src/tools/file-search.js";
import { bashTool } from "../src/tools/bash.js";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

describe("file-read tool", () => {
  test("reads an existing file", async () => {
    const result = await fileReadTool.execute!(
      { path: join(import.meta.dir, "config.test.ts"), encoding: "utf-8" },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(result.content).toContain("parseConfig");
    expect(result.size).toBeGreaterThan(0);
  });

  test("fails on non-existent file", async () => {
    await expect(
      fileReadTool.execute!(
        { path: "/tmp/nonexistent-claw-test-file.txt", encoding: "utf-8" },
        { toolCallId: "test", messages: [], abortSignal: undefined as any },
      ),
    ).rejects.toThrow();
  });
});

describe("file-write tool", () => {
  let tmpDir: string;

  test("writes a file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-test-"));
    const filePath = join(tmpDir, "test.txt");
    const result = await fileWriteTool.execute!(
      { path: filePath, content: "hello world", append: false },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(result.path).toBe(filePath);
    expect(result.bytesWritten).toBe(11);

    // Verify by reading back
    const readResult = await fileReadTool.execute!(
      { path: filePath, encoding: "utf-8" },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(readResult.content).toBe("hello world");
    await rm(tmpDir, { recursive: true });
  });
});

describe("file-search tool", () => {
  test("finds files by pattern", async () => {
    const result = await fileSearchTool.execute!(
      {
        directory: join(import.meta.dir, ".."),
        pattern: "*.ts",
        maxResults: 20,
        maxDepth: 2,
      },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(result.resultCount).toBeGreaterThan(0);
    const paths = result.results.map((r: any) => r.path);
    expect(paths.some((p: string) => p.endsWith(".ts"))).toBe(true);
  });

  test("searches file contents", async () => {
    const result = await fileSearchTool.execute!(
      {
        directory: join(import.meta.dir, ".."),
        pattern: "*.ts",
        contentPattern: "parseConfig",
        maxResults: 10,
        maxDepth: 3,
      },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(result.resultCount).toBeGreaterThan(0);
    expect(result.results[0].matches.length).toBeGreaterThan(0);
  });
});

describe("bash tool", () => {
  test("executes a simple command", async () => {
    const result = await bashTool.execute!(
      { command: "echo hello", timeout: 5000 },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  test("captures stderr", async () => {
    const result = await bashTool.execute!(
      { command: "echo error >&2", timeout: 5000 },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("error");
  });

  test("reports non-zero exit code", async () => {
    const result = await bashTool.execute!(
      { command: "exit 42", timeout: 5000 },
      { toolCallId: "test", messages: [], abortSignal: undefined as any },
    );
    expect(result.exitCode).toBe(42);
  });
});
