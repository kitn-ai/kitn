import { gunzip } from "zlib";
import { promisify } from "util";
import { mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";

const gunzipAsync = promisify(gunzip);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TarEntry {
  path: string;
  content: Buffer;
}

// ---------------------------------------------------------------------------
// Tar parser
// ---------------------------------------------------------------------------

/**
 * Parse a raw tar buffer into entries.
 *
 * Tar format: repeating 512-byte header + ceil(size/512)*512 bytes of data.
 * We only extract regular files (type '0' or '\0').
 */
function parseTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);

    // Empty block = end of archive
    if (header.every((b) => b === 0)) break;

    // Name: bytes 0–99 (may be extended by prefix at 345–499)
    const prefix = header.subarray(345, 500).toString("utf-8").replace(/\0+$/, "");
    const name = header.subarray(0, 100).toString("utf-8").replace(/\0+$/, "");
    const fullName = prefix ? `${prefix}/${name}` : name;

    // Size: bytes 124–135 (octal, null-terminated)
    const sizeStr = header.subarray(124, 136).toString("utf-8").replace(/\0+$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;

    // Type flag: byte 156
    const typeFlag = String.fromCharCode(header[156]);

    offset += 512;

    if (typeFlag === "0" || typeFlag === "\0") {
      // Regular file
      const content = Buffer.from(buf.subarray(offset, offset + size));
      entries.push({ path: fullName, content });
    }
    // Skip pax headers (type 'x', 'g'), directories ('5'), symlinks ('2'), etc.

    // Advance past data blocks (rounded up to 512)
    offset += Math.ceil(size / 512) * 512;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a .tar.gz buffer into TarEntry objects.
 *
 * Options:
 * - `prefix`: only include entries whose path starts with this prefix
 *   (the prefix is stripped from the output path)
 * - `stripRoot`: strip the first path component from all entries (default: true).
 *   GitHub tarballs always have a root dir like `repo-main/`.
 */
export async function extractTarGz(
  buffer: Buffer,
  opts?: { prefix?: string; stripRoot?: boolean },
): Promise<TarEntry[]> {
  const decompressed = await gunzipAsync(buffer);
  let entries = parseTar(decompressed as Buffer);

  // Strip root directory (e.g. "kitn-main/")
  const stripRoot = opts?.stripRoot ?? true;
  if (stripRoot) {
    entries = entries
      .map((e) => {
        const idx = e.path.indexOf("/");
        if (idx === -1) return null; // root-level file with no slash — skip
        return { ...e, path: e.path.slice(idx + 1) };
      })
      .filter((e): e is TarEntry => e !== null && e.path.length > 0);
  }

  // Filter by prefix
  const prefix = opts?.prefix;
  if (prefix) {
    const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
    entries = entries
      .filter((e) => e.path.startsWith(normalized) || e.path === prefix)
      .map((e) => ({
        ...e,
        path: e.path.startsWith(normalized) ? e.path.slice(normalized.length) : e.path,
      }))
      .filter((e) => e.path.length > 0);
  }

  return entries;
}

/**
 * Write extracted tar entries to a destination directory.
 * Returns the list of created file paths (absolute).
 */
export async function writeTarEntries(
  entries: TarEntry[],
  destDir: string,
): Promise<string[]> {
  const created: string[] = [];

  for (const entry of entries) {
    const filePath = join(destDir, entry.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, entry.content);
    created.push(filePath);
  }

  return created;
}
