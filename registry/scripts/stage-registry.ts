/**
 * Builds a _staging/ directory that mirrors the installed layout using symlinks.
 * This enables IDE type-checking of @kitn/ alias imports via tsconfig paths.
 *
 * Run: bun run stage
 *
 * Creates:
 *   _staging/agents/weather-agent.ts → ../components/agents/weather-agent/weather-agent.ts
 *   _staging/tools/weather.ts        → ../components/tools/weather-tool/weather.ts
 *   ...
 */

import { readdir, readFile, mkdir, symlink, rm } from "fs/promises";
import { join, relative, dirname } from "path";

const ROOT = new URL("..", import.meta.url).pathname;
const COMPONENTS_DIR = join(ROOT, "components");
const STAGING_DIR = join(ROOT, "_staging");

const typeToDir: Record<string, string> = {
  "kitn:agent": "agents",
  "kitn:tool": "tools",
  "kitn:skill": "skills",
  "kitn:storage": "storage",
};

async function main() {
  // Clean previous staging
  await rm(STAGING_DIR, { recursive: true, force: true });

  let linkCount = 0;

  for (const typeDir of ["agents", "tools", "skills", "storage"]) {
    const dir = join(COMPONENTS_DIR, typeDir);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const manifestPath = join(dir, entry, "manifest.json");
      let manifestRaw: string;
      try {
        manifestRaw = await readFile(manifestPath, "utf-8");
      } catch {
        continue;
      }

      const manifest = JSON.parse(manifestRaw);
      const installDir = typeToDir[manifest.type];
      if (!installDir) continue;

      for (const fileName of manifest.files ?? []) {
        // Only stage TypeScript files (skip .md skills etc.)
        if (!fileName.endsWith(".ts")) continue;

        const sourcePath = join(dir, entry, fileName);
        const stagingPath = join(STAGING_DIR, installDir, fileName);

        await mkdir(dirname(stagingPath), { recursive: true });

        // Create relative symlink from staging to source
        const relTarget = relative(dirname(stagingPath), sourcePath);
        await symlink(relTarget, stagingPath);
        linkCount++;
      }
    }
  }

  console.log(`Staged ${linkCount} files in _staging/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
