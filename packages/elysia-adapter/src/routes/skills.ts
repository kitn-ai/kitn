import { Elysia } from "elysia";
import type { PluginContext } from "@kitnai/core";

export function createSkillsRoutes(ctx: PluginContext) {
  const store = ctx.storage.skills;

  return new Elysia({ prefix: "/skills" })
    .get("/", async () => {
      const skills = await store.listSkills();
      return { skills, count: skills.length };
    })
    .get("/:name", async ({ params, status }) => {
      const skill = await store.getSkill(params.name);
      if (!skill) return status(404, { error: "Skill not found" });
      return skill;
    })
    .post("/", async ({ body, status }) => {
      const { name, content } = body as any;
      try {
        const skill = await store.createSkill(name, content);
        return skill;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return status(400, { error: message });
      }
    })
    .put("/:name", async ({ params, body, status }) => {
      const { content } = body as any;
      try {
        const skill = await store.updateSkill(params.name, content);
        return skill;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return status(404, { error: message });
      }
    })
    .delete("/:name", async ({ params, status }) => {
      const deleted = await store.deleteSkill(params.name);
      if (!deleted) return status(404, { error: "Skill not found" });
      return { deleted: true, name: params.name };
    });
}
