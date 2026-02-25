import type { Context } from "hono";
import type { PluginContext } from "../../context.js";

export function createSkillsHandlers(ctx: PluginContext) {
  const store = ctx.storage.skills;

  return {
    async handleListSkills(c: Context) {
      const skills = await store.listSkills();
      return c.json({ skills, count: skills.length }, 200);
    },

    async handleGetSkill(c: Context) {
      const name = c.req.param("name");
      const skill = await store.getSkill(name);
      if (!skill) return c.json({ error: "Skill not found" }, 404);
      return c.json(skill, 200);
    },

    async handleCreateSkill(c: Context) {
      const { name, content } = await c.req.json();
      try {
        const skill = await store.createSkill(name, content);
        return c.json(skill, 201);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 400);
      }
    },

    async handleUpdateSkill(c: Context) {
      const name = c.req.param("name");
      const { content } = await c.req.json();
      try {
        const skill = await store.updateSkill(name, content);
        return c.json(skill, 200);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json({ error: message }, 404);
      }
    },

    async handleDeleteSkill(c: Context) {
      const name = c.req.param("name");
      const deleted = await store.deleteSkill(name);
      if (!deleted) return c.json({ error: "Skill not found" }, 404);
      return c.json({ deleted: true, name }, 200);
    },
  };
}
