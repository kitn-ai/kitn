import { Hono } from "hono";
import type { PluginContext } from "@kitnai/core";
import { createSkillsHandlers } from "./skills.handlers.js";

export function createSkillsRoutes(ctx: PluginContext) {
  const router = new Hono();
  const handlers = createSkillsHandlers(ctx);

  // GET / — List all skills
  router.get("/", handlers.handleListSkills);

  // GET /:name — Get a specific skill by name
  router.get("/:name", handlers.handleGetSkill);

  // POST / — Create a new skill
  router.post("/", handlers.handleCreateSkill);

  // PUT /:name — Update an existing skill
  router.put("/:name", handlers.handleUpdateSkill);

  // DELETE /:name — Delete a skill
  router.delete("/:name", handlers.handleDeleteSkill);

  return router;
}
