import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import pc from "picocolors";

const CACHE_DIR = join(homedir(), ".kitn");
const CACHE_FILE = join(CACHE_DIR, "update-check.json");
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  latest: string;
  checkedAt: number;
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCache(entry: CacheEntry): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(entry));
  } catch {
    // Silently ignore cache write failures
  }
}

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://registry.npmjs.org/@kitnai/cli/latest", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export function isNewer(latest: string, current: string): boolean {
  const [lMaj, lMin, lPat] = latest.split(".").map(Number);
  const [cMaj, cMin, cPat] = current.split(".").map(Number);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/**
 * Starts a non-blocking update check. Returns a function that,
 * when called, prints the update notice if a newer version was found.
 */
export function startUpdateCheck(currentVersion: string): () => void {
  let message = "";

  // Fire-and-forget: don't block CLI startup
  const check = (async () => {
    const cache = await readCache();
    let latest: string | null = null;

    if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL) {
      latest = cache.latest;
    } else {
      latest = await fetchLatestVersion();
      if (latest) {
        await writeCache({ latest, checkedAt: Date.now() });
      }
    }

    if (latest && isNewer(latest, currentVersion)) {
      message = [
        "",
        pc.yellow(`  Update available: ${pc.dim(currentVersion)} → ${pc.green(latest)}`),
        pc.dim(`  Run ${pc.cyan("npx @kitnai/cli@latest")} or ${pc.cyan("npm i -g @kitnai/cli")}`),
        "",
      ].join("\n");
    }
  })();

  // Suppress unhandled rejection from the fire-and-forget promise
  check.catch(() => {});

  return () => {
    if (message) process.stderr.write(message);
  };
}
