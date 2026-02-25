import { createRoute, z } from "@hono/zod-openapi";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { PluginContext } from "../../context.js";
import { skillMetaSchema, skillSchema, skillCreateSchema, skillUpdateSchema } from "./skills.schemas.js";
import { createSkillsHandlers } from "./skills.handlers.js";

export function createSkillsRoutes(ctx: PluginContext) {
  const router = new OpenAPIHono();
  const handlers = createSkillsHandlers(ctx);

  router.openapi(
    createRoute({
      method: "get", path: "/", tags: ["Skills"], summary: "List all skills",
      responses: { 200: { description: "All skills", content: { "application/json": { schema: z.object({ skills: z.array(skillMetaSchema), count: z.number() }) } } } },
    }),
    handlers.handleListSkills,
  );

  router.openapi(
    createRoute({
      method: "get", path: "/{name}", tags: ["Skills"], summary: "Get a specific skill by name",
      request: { params: z.object({ name: z.string().openapi({ example: "eli5" }) }) },
      responses: {
        200: { description: "Skill details", content: { "application/json": { schema: skillSchema } } },
        404: { description: "Skill not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    handlers.handleGetSkill,
  );

  router.openapi(
    createRoute({
      method: "post", path: "/", tags: ["Skills"], summary: "Create a new skill",
      request: { body: { content: { "application/json": { schema: skillCreateSchema } } } },
      responses: {
        201: { description: "Skill created", content: { "application/json": { schema: skillSchema } } },
        400: { description: "Invalid input", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    handlers.handleCreateSkill,
  );

  router.openapi(
    createRoute({
      method: "put", path: "/{name}", tags: ["Skills"], summary: "Update an existing skill",
      request: { params: z.object({ name: z.string().openapi({ example: "eli5" }) }), body: { content: { "application/json": { schema: skillUpdateSchema } } } },
      responses: {
        200: { description: "Skill updated", content: { "application/json": { schema: skillSchema } } },
        404: { description: "Skill not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    handlers.handleUpdateSkill,
  );

  router.openapi(
    createRoute({
      method: "delete", path: "/{name}", tags: ["Skills"], summary: "Delete a skill",
      request: { params: z.object({ name: z.string().openapi({ example: "eli5" }) }) },
      responses: {
        200: { description: "Skill deleted", content: { "application/json": { schema: z.object({ deleted: z.boolean(), name: z.string() }) } } },
        404: { description: "Skill not found", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
      },
    }),
    handlers.handleDeleteSkill,
  );

  return router;
}
