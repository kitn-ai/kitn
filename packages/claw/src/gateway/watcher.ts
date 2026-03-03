import { watch, type FSWatcher } from "fs";
import { readdir, stat } from "fs/promises";
import { join, extname, basename } from "path";
import type { PluginContext } from "@kitnai/core";
import { CLAW_HOME } from "../config/io.js";

const WORKSPACE = join(CLAW_HOME, "workspace");
const DEBOUNCE_MS = 300;

/**
 * Watch the workspace directory for changes and hot-reload
 * tools, agents, and skills into the @kitnai/core registries.
 */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private ctx: PluginContext;

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    // Ensure workspace directories exist
    const { mkdir } = await import("fs/promises");
    for (const dir of ["tools", "agents", "skills"]) {
      await mkdir(join(WORKSPACE, dir), { recursive: true });
    }

    // Initial load
    await this.loadAll();

    // Watch for changes
    try {
      this.watcher = watch(WORKSPACE, { recursive: true }, (event, filename) => {
        if (!filename) return;
        this.debounced(filename, () => this.handleChange(filename));
      });
    } catch {
      console.log("[kitnclaw] File watching not available — hot-reload disabled");
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private debounced(key: string, fn: () => void): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      fn();
    }, DEBOUNCE_MS));
  }

  private async handleChange(filename: string): Promise<void> {
    const ext = extname(filename);

    if (ext === ".ts" || ext === ".tsx" || ext === ".js") {
      const fullPath = join(WORKSPACE, filename);

      try {
        // Check if file still exists (might have been deleted)
        await stat(fullPath);
      } catch {
        console.log(`[kitnclaw] Removed: ${filename}`);
        return;
      }

      // Invalidate Bun's module cache and re-import
      try {
        // Delete from require cache if present
        const resolved = require.resolve(fullPath);
        delete require.cache[resolved];
      } catch {
        // Not in cache, that's fine
      }

      try {
        await import(fullPath + `?t=${Date.now()}`);
        console.log(`[kitnclaw] Reloaded: ${filename}`);
      } catch (err: any) {
        console.error(`[kitnclaw] Failed to reload ${filename}: ${err.message}`);
      }
    } else if (ext === ".md") {
      // Skills are markdown files — reload into skill store
      if (filename.startsWith("skills/")) {
        console.log(`[kitnclaw] Skill updated: ${filename}`);
        // TODO: Load skill content into skill store
      }
    }
  }

  private async loadAll(): Promise<void> {
    for (const dir of ["tools", "agents"]) {
      const dirPath = join(WORKSPACE, dir);
      try {
        const files = await readdir(dirPath);
        for (const file of files) {
          const ext = extname(file);
          if (ext === ".ts" || ext === ".tsx" || ext === ".js") {
            try {
              await import(join(dirPath, file));
            } catch (err: any) {
              console.error(`[kitnclaw] Failed to load ${dir}/${file}: ${err.message}`);
            }
          }
        }
      } catch {
        // Directory doesn't exist yet
      }
    }
  }
}
