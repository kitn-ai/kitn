import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { checkFileStatus, writeComponentFile, FileStatus } from "./file-writer.js";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("file-writer", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kitn-writer-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("checkFileStatus", () => {
    it("returns 'new' when file does not exist", async () => {
      const status = await checkFileStatus(join(tempDir, "new.ts"), "content");
      expect(status).toBe(FileStatus.New);
    });

    it("returns 'identical' when content matches", async () => {
      const filePath = join(tempDir, "existing.ts");
      await writeFile(filePath, "same content");
      const status = await checkFileStatus(filePath, "same content");
      expect(status).toBe(FileStatus.Identical);
    });

    it("returns 'different' when content differs", async () => {
      const filePath = join(tempDir, "existing.ts");
      await writeFile(filePath, "old content");
      const status = await checkFileStatus(filePath, "new content");
      expect(status).toBe(FileStatus.Different);
    });
  });

  describe("writeComponentFile", () => {
    it("creates file and parent directories", async () => {
      const filePath = join(tempDir, "deep/nested/file.ts");
      await writeComponentFile(filePath, "hello world");
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("hello world");
    });
  });
});
