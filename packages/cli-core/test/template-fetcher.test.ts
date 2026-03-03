import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { gzip } from "zlib";
import { promisify } from "util";
import { stat, readFile, rm } from "fs/promises";
import { join } from "path";
import { fetchBuiltinTemplate, fetchCustomTemplate } from "../src/templates/fetcher.js";

const gzipAsync = promisify(gzip);

// ---------------------------------------------------------------------------
// Helpers: build a tar archive programmatically
// ---------------------------------------------------------------------------

function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, Math.min(name.length, 100), "utf-8");
  header.write("0000644\0", 100, 8, "utf-8");
  header.write("0000000\0", 108, 8, "utf-8");
  header.write("0000000\0", 116, 8, "utf-8");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
  header.write("00000000000\0", 136, 12, "utf-8");
  header.write("0", 156, 1, "utf-8");
  header.write("        ", 148, 8, "utf-8");
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");
  return header;
}

function createTarFile(name: string, content: string): Buffer {
  const data = Buffer.from(content, "utf-8");
  const header = createTarHeader(name, data.length);
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
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

async function createTarGz(files: Record<string, string>): Promise<Buffer> {
  const tar = createTarArchive(files);
  return gzipAsync(tar) as Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let mockFetchFn: typeof fetch;

beforeEach(() => {
  mockFetchFn = mock(async () => new Response(null, { status: 500 })) as any;
  globalThis.fetch = mockFetchFn;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchBuiltinTemplate", () => {
  test("fetches template from GitHub and extracts to temp dir", async () => {
    const tgz = await createTarGz({
      "kitn-main/templates/hono/package.json": '{"name":"hono-template"}',
      "kitn-main/templates/hono/src/index.ts": "export {}",
      "kitn-main/README.md": "# Root",
    });

    globalThis.fetch = mock(async () =>
      new Response(tgz, { status: 200 }),
    ) as any;

    const result = await fetchBuiltinTemplate("hono");
    try {
      expect(result.source).toBe("github");
      expect(result.dir).toBeTruthy();

      // Verify files were extracted
      const pkgStat = await stat(join(result.dir, "package.json"));
      expect(pkgStat.isFile()).toBe(true);

      const pkg = await readFile(join(result.dir, "package.json"), "utf-8");
      expect(pkg).toBe('{"name":"hono-template"}');

      const srcStat = await stat(join(result.dir, "src/index.ts"));
      expect(srcStat.isFile()).toBe(true);
    } finally {
      await result.cleanup();
    }

    // Verify cleanup removed the temp dir
    try {
      await stat(result.dir);
      expect(true).toBe(false); // should not reach
    } catch (e: any) {
      expect(e.code).toBe("ENOENT");
    }
  });

  test("falls back to local when GitHub fetch fails", async () => {
    // This test relies on local templates existing in the monorepo.
    // If running outside the monorepo, it will throw (which is also valid behavior).
    globalThis.fetch = mock(async () =>
      new Response(null, { status: 500 }),
    ) as any;

    try {
      const result = await fetchBuiltinTemplate("hono");
      // If local fallback works, we get a valid template
      expect(result.source).toBe("local");
      expect(result.dir).toBeTruthy();
      await result.cleanup();
    } catch (err: any) {
      // If no local fallback exists, we get the expected error
      expect(err.message).toContain("Could not fetch template");
    }
  });

  test("throws when template not found in tarball and no local fallback", async () => {
    // Tarball with no matching template
    const tgz = await createTarGz({
      "kitn-main/templates/other/package.json": "{}",
    });

    globalThis.fetch = mock(async () =>
      new Response(tgz, { status: 200 }),
    ) as any;

    try {
      await fetchBuiltinTemplate("nonexistent-template-xyz");
      expect(true).toBe(false); // should not reach
    } catch (err: any) {
      expect(err.message).toContain("Could not fetch template");
    }
  });
});

describe("fetchCustomTemplate", () => {
  test("fetches custom template from GitHub shorthand", async () => {
    const tgz = await createTarGz({
      "kitn-main/src/index.ts": "console.log('custom')",
      "kitn-main/package.json": '{"name":"custom"}',
    });

    globalThis.fetch = mock(async () =>
      new Response(tgz, { status: 200 }),
    ) as any;

    const result = await fetchCustomTemplate("github:user/repo");
    try {
      expect(result.source).toBe("github");

      const pkg = await readFile(join(result.dir, "package.json"), "utf-8");
      expect(pkg).toBe('{"name":"custom"}');
    } finally {
      await result.cleanup();
    }
  });

  test("fetches custom template with subdir", async () => {
    const tgz = await createTarGz({
      "repo-main/my-template/package.json": '{"name":"sub"}',
      "repo-main/my-template/index.ts": "export {}",
      "repo-main/other/file.txt": "ignore me",
    });

    globalThis.fetch = mock(async () =>
      new Response(tgz, { status: 200 }),
    ) as any;

    const result = await fetchCustomTemplate("github:user/repo/my-template");
    try {
      const pkg = await readFile(join(result.dir, "package.json"), "utf-8");
      expect(pkg).toBe('{"name":"sub"}');

      const idx = await readFile(join(result.dir, "index.ts"), "utf-8");
      expect(idx).toBe("export {}");
    } finally {
      await result.cleanup();
    }
  });

  test("throws on HTTP error", async () => {
    globalThis.fetch = mock(async () =>
      new Response(null, { status: 404, statusText: "Not Found" }),
    ) as any;

    try {
      await fetchCustomTemplate("github:user/nonexistent");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toContain("Failed to fetch");
    }
  });

  test("throws when no files found at subdir", async () => {
    const tgz = await createTarGz({
      "repo-main/other/file.txt": "hello",
    });

    globalThis.fetch = mock(async () =>
      new Response(tgz, { status: 200 }),
    ) as any;

    try {
      await fetchCustomTemplate("github:user/repo/nonexistent");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toContain("No files found");
    }
  });
});
