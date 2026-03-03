import { describe, test, expect } from "bun:test";
import { gzip } from "zlib";
import { promisify } from "util";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { extractTarGz, writeTarEntries } from "../src/templates/tar.js";

const gzipAsync = promisify(gzip);

// ---------------------------------------------------------------------------
// Helpers: build a tar archive programmatically
// ---------------------------------------------------------------------------

function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);

  // Name (bytes 0–99)
  header.write(name, 0, Math.min(name.length, 100), "utf-8");

  // Mode (bytes 100–107) — 0644
  header.write("0000644\0", 100, 8, "utf-8");

  // UID (108–115), GID (116–123) — 0
  header.write("0000000\0", 108, 8, "utf-8");
  header.write("0000000\0", 116, 8, "utf-8");

  // Size (bytes 124–135) — octal
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");

  // Mtime (136–147) — 0
  header.write("00000000000\0", 136, 12, "utf-8");

  // Type flag (byte 156) — '0' for regular file
  header.write("0", 156, 1, "utf-8");

  // Checksum placeholder (bytes 148–155) — spaces
  header.write("        ", 148, 8, "utf-8");

  // Compute checksum (sum of all bytes, treating checksum field as spaces)
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");

  return header;
}

function createTarFile(name: string, content: string): Buffer {
  const data = Buffer.from(content, "utf-8");
  const header = createTarHeader(name, data.length);

  // Pad data to 512-byte boundary
  const paddedSize = Math.ceil(data.length / 512) * 512;
  const paddedData = Buffer.alloc(paddedSize);
  data.copy(paddedData);

  return Buffer.concat([header, paddedData]);
}

function createTarArchive(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    parts.push(createTarFile(name, content));
  }
  // End-of-archive: two 512-byte zero blocks
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

async function createTarGz(files: Record<string, string>): Promise<Buffer> {
  const tar = createTarArchive(files);
  return gzipAsync(tar) as Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractTarGz", () => {
  test("extracts files from tar.gz with root stripping", async () => {
    const tgz = await createTarGz({
      "repo-main/README.md": "# Hello",
      "repo-main/src/index.ts": "console.log('hi')",
    });

    const entries = await extractTarGz(tgz);
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe("README.md");
    expect(entries[0].content.toString()).toBe("# Hello");
    expect(entries[1].path).toBe("src/index.ts");
    expect(entries[1].content.toString()).toBe("console.log('hi')");
  });

  test("filters by prefix and strips it", async () => {
    const tgz = await createTarGz({
      "repo-main/templates/hono/package.json": '{"name":"hono"}',
      "repo-main/templates/hono/src/index.ts": "export {}",
      "repo-main/templates/other/package.json": '{"name":"other"}',
      "repo-main/README.md": "# Root",
    });

    const entries = await extractTarGz(tgz, { prefix: "templates/hono" });
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe("package.json");
    expect(entries[1].path).toBe("src/index.ts");
  });

  test("returns empty array when prefix matches nothing", async () => {
    const tgz = await createTarGz({
      "repo-main/src/index.ts": "hello",
    });

    const entries = await extractTarGz(tgz, { prefix: "nonexistent" });
    expect(entries).toHaveLength(0);
  });

  test("stripRoot: false preserves full paths", async () => {
    const tgz = await createTarGz({
      "repo-main/file.txt": "content",
    });

    const entries = await extractTarGz(tgz, { stripRoot: false });
    expect(entries[0].path).toBe("repo-main/file.txt");
  });
});

describe("writeTarEntries", () => {
  test("writes entries to disk and returns paths", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "tar-test-"));
    try {
      const entries = [
        { path: "hello.txt", content: Buffer.from("world") },
        { path: "sub/nested.txt", content: Buffer.from("deep") },
      ];

      const created = await writeTarEntries(entries, tmpDir);
      expect(created).toHaveLength(2);
      expect(created[0]).toBe(join(tmpDir, "hello.txt"));
      expect(created[1]).toBe(join(tmpDir, "sub/nested.txt"));

      const content1 = await readFile(join(tmpDir, "hello.txt"), "utf-8");
      expect(content1).toBe("world");

      const content2 = await readFile(join(tmpDir, "sub/nested.txt"), "utf-8");
      expect(content2).toBe("deep");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
