import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

const HelloResponseSchema = z.object({
  message: z.string().openapi({ example: "Hello, World!" }),
});

const route = createRoute({
  method: "get",
  path: "/hello/{name}",
  tags: ["Example"],
  summary: "Say hello",
  description: "Returns a greeting for the given name",
  request: {
    params: z.object({
      name: z.string().min(1).openapi({ example: "World" }),
    }),
  },
  responses: {
    200: {
      description: "A greeting",
      content: {
        "application/json": { schema: HelloResponseSchema },
      },
    },
  },
});

export function registerHelloRoute(app: OpenAPIHono) {
  app.openapi(route, (c) => {
    const { name } = c.req.valid("param");
    return c.json({ message: `Hello, ${name}!` });
  });
}
