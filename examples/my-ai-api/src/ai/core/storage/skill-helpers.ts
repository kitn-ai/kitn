import type { Skill, SkillPhase } from "./interfaces.js";

const VALID_PHASES = new Set<SkillPhase>(["query", "response", "both"]);

export const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Simple frontmatter parser — handles `key: value` and `key: [a, b]` */
export function parseFrontmatter(raw: string): {
  meta: Record<string, string | string[]>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string | string[]> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    const arrMatch = value.match(/^\[(.*)\]$/);
    if (arrMatch) {
      meta[key] = arrMatch[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      meta[key] = value;
    }
  }

  return { meta, body: match[2]! };
}

export function parsePhase(value: unknown): SkillPhase {
  if (typeof value === "string" && VALID_PHASES.has(value as SkillPhase)) {
    return value as SkillPhase;
  }
  return "response";
}

export function buildSkill(name: string, raw: string): Skill {
  const { meta, body } = parseFrontmatter(raw);
  return {
    name: (meta.name as string) || name,
    description: (meta.description as string) || "",
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    phase: parsePhase(meta.phase),
    content: body.trim(),
    rawContent: raw,
    updatedAt: new Date().toISOString(),
  };
}
