import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AudioStore, AudioEntry } from "../interfaces.js";

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

export function createAudioStore(dataDir: string): AudioStore {
  const dir = join(dataDir, "audio");

  async function ensureDir() {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  return {
    async saveAudio(buffer, mimeType, metadata?) {
      await ensureDir();
      const id = generateId();
      const ext = extension(mimeType);
      const audioPath = join(dir, `${id}.${ext}`);
      const metaPath = join(dir, `${id}${META_SUFFIX}`);
      const entry: AudioEntry = { id, mimeType, size: buffer.length, createdAt: new Date().toISOString(), metadata };
      await Promise.all([writeFile(audioPath, buffer), writeFile(metaPath, JSON.stringify(entry, null, 2))]);
      return entry;
    },

    async getAudio(id) {
      await ensureDir();
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

    async deleteAudio(id) {
      await ensureDir();
      const files = await readdir(dir);
      const matching = files.filter((f) => f.startsWith(id));
      if (matching.length === 0) return false;
      await Promise.all(matching.map((f) => unlink(join(dir, f))));
      return true;
    },

    async listAudio() {
      await ensureDir();
      const files = await readdir(dir);
      const metaFiles = files.filter((f) => f.endsWith(META_SUFFIX));
      const entries: AudioEntry[] = [];
      for (const metaFile of metaFiles) {
        try {
          const raw = await readFile(join(dir, metaFile), "utf-8");
          entries.push(JSON.parse(raw));
        } catch { /* skip corrupted */ }
      }
      return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async cleanupOlderThan(maxAgeMs) {
      await ensureDir();
      const cutoff = Date.now() - maxAgeMs;
      const entries = await this.listAudio();
      let deleted = 0;
      for (const entry of entries) {
        if (new Date(entry.createdAt).getTime() < cutoff) {
          await this.deleteAudio(entry.id);
          deleted++;
        }
      }
      return deleted;
    },
  };
}
