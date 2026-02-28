import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AudioStore, AudioEntry } from "./audio-store.js";

const META_SUFFIX = ".meta.json";

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

function extension(mimeType: string): string {
  const map: Record<string, string> = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/webm": "webm",
    "video/webm": "webm", "audio/wav": "wav", "audio/ogg": "ogg",
    "audio/opus": "opus", "audio/aac": "aac", "audio/flac": "flac",
  };
  return map[mimeType] ?? "bin";
}

/**
 * Creates a file-based AudioStore that persists audio files to disk.
 * Audio files and their metadata are stored in `{dataDir}/audio/`.
 *
 * @param dataDir - Base directory for data storage (audio will be stored in `{dataDir}/audio/`)
 */
export function createFileAudioStore(dataDir: string): AudioStore {
  const baseDir = join(dataDir, "audio");

  /** Resolve the directory for a given scope (or the base dir for global). */
  function scopeDir(scopeId?: string): string {
    return scopeId ? join(baseDir, scopeId) : baseDir;
  }

  async function ensureDir(dir: string) {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  /** List meta entries from a single directory. */
  async function listMetaInDir(dir: string): Promise<AudioEntry[]> {
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const metaFiles = files.filter((f) => f.endsWith(META_SUFFIX));
    const entries: AudioEntry[] = [];
    for (const metaFile of metaFiles) {
      try {
        const raw = await readFile(join(dir, metaFile), "utf-8");
        entries.push(JSON.parse(raw));
      } catch { /* skip corrupted */ }
    }
    return entries;
  }

  return {
    async saveAudio(buffer, mimeType, metadata?, scopeId?) {
      const dir = scopeDir(scopeId);
      await ensureDir(dir);
      const id = generateId();
      const ext = extension(mimeType);
      const audioPath = join(dir, `${id}.${ext}`);
      const metaPath = join(dir, `${id}${META_SUFFIX}`);
      const entry: AudioEntry = { id, mimeType, size: buffer.length, createdAt: new Date().toISOString(), metadata };
      await Promise.all([writeFile(audioPath, buffer), writeFile(metaPath, JSON.stringify(entry, null, 2))]);
      return entry;
    },

    async getAudio(id, scopeId?) {
      const dir = scopeDir(scopeId);
      await ensureDir(dir);
      const files = await readdir(dir);
      const metaFile = files.find((f) => f.startsWith(id) && f.endsWith(META_SUFFIX));
      if (!metaFile) return null;
      const metaPath = join(dir, metaFile);
      const raw = await readFile(metaPath, "utf-8");
      const entry: AudioEntry = JSON.parse(raw);
      const audioFile = files.find((f) => f.startsWith(id) && !f.endsWith(META_SUFFIX));
      if (!audioFile) return null;
      const data = await readFile(join(dir, audioFile));
      return { entry, data };
    },

    async deleteAudio(id, scopeId?) {
      const dir = scopeDir(scopeId);
      await ensureDir(dir);
      const files = await readdir(dir);
      const matching = files.filter((f) => f.startsWith(id));
      if (matching.length === 0) return false;
      await Promise.all(matching.map((f) => unlink(join(dir, f))));
      return true;
    },

    async listAudio(scopeId?) {
      if (scopeId) {
        const dir = scopeDir(scopeId);
        await ensureDir(dir);
        const entries = await listMetaInDir(dir);
        return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
      // Without scopeId: list from base dir + all subdirectories
      await ensureDir(baseDir);
      const entries = await listMetaInDir(baseDir);
      const dirEntries = await readdir(baseDir, { withFileTypes: true });
      for (const dirEntry of dirEntries) {
        if (!dirEntry.isDirectory()) continue;
        const subEntries = await listMetaInDir(join(baseDir, dirEntry.name));
        entries.push(...subEntries);
      }
      return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async cleanupOlderThan(maxAgeMs, scopeId?) {
      const cutoff = Date.now() - maxAgeMs;
      const entries = await this.listAudio(scopeId);
      let deleted = 0;
      for (const entry of entries) {
        if (new Date(entry.createdAt).getTime() < cutoff) {
          await this.deleteAudio(entry.id, scopeId);
          deleted++;
        }
      }
      return deleted;
    },
  };
}
