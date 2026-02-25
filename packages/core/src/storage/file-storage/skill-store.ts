import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SkillStore, SkillMeta } from "../interfaces.js";
import { parseFrontmatter, parsePhase, buildSkill, KEBAB_CASE } from "../skill-helpers.js";

// Re-export for any external consumers that imported from here
export { parseFrontmatter } from "../skill-helpers.js";

export function createSkillStore(dataDir: string): SkillStore {
  const dir = join(dataDir, "skills");

  const locks = new Map<string, Promise<void>>();
  function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(name) ?? Promise.resolve();
    let result: Promise<T>;
    const next = prev
      .then(async () => { result = fn(); await result; })
      .catch(() => {});
    locks.set(name, next);
    return next.then(() => result!);
  }

  function skillDir(name: string): string { return join(dir, name); }
  function readmePath(name: string): string { return join(dir, name, "README.md"); }

  async function ensureDir() {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  return {
    async listSkills() {
      await ensureDir();
      const entries = await readdir(dir, { withFileTypes: true });
      const skills: SkillMeta[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const readme = readmePath(entry.name);
        if (!existsSync(readme)) continue;
        const raw = await readFile(readme, "utf-8");
        const { meta } = parseFrontmatter(raw);
        skills.push({
          name: (meta.name as string) || entry.name,
          description: (meta.description as string) || "",
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          phase: parsePhase(meta.phase),
        });
      }
      return skills;
    },

    async getSkill(name) {
      await ensureDir();
      const path = readmePath(name);
      if (!existsSync(path)) return null;
      const raw = await readFile(path, "utf-8");
      return buildSkill(name, raw);
    },

    createSkill(name, content) {
      if (!KEBAB_CASE.test(name)) {
        throw new Error(`Invalid skill name "${name}": must be kebab-case (e.g. "my-skill")`);
      }
      return withLock(name, async () => {
        await ensureDir();
        const d = skillDir(name);
        if (existsSync(d)) throw new Error(`Skill "${name}" already exists`);
        await mkdir(d, { recursive: true });
        await writeFile(readmePath(name), content, "utf-8");
        return buildSkill(name, content);
      });
    },

    updateSkill(name, content) {
      return withLock(name, async () => {
        await ensureDir();
        const path = readmePath(name);
        if (!existsSync(path)) throw new Error(`Skill "${name}" not found`);
        await writeFile(path, content, "utf-8");
        return buildSkill(name, content);
      });
    },

    deleteSkill(name) {
      return withLock(name, async () => {
        await ensureDir();
        const d = skillDir(name);
        if (!existsSync(d)) return false;
        await rm(d, { recursive: true });
        return true;
      });
    },

    async getSkillSummaries() {
      const skills = await this.listSkills();
      if (skills.length === 0) return "No skills available.";
      return skills.map((s) => `- ${s.name} [${s.phase}]: ${s.description}`).join("\n");
    },
  };
}
