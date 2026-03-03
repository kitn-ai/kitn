import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { Scalar } from "@scalar/hono-api-reference";
import { HealthCheckResponseSchema } from "./schemas/common.js";
import { registerHelloRoute } from "./routes/hello.js";
import { registerCheckRoute } from "./routes/check.js";
import { ai } from "./ai.js";
import type { Env } from "./env.js";

export function createApp(env: Env) {
  const app = new OpenAPIHono();

  // Middleware
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const s = c.res.status;
    const icon = s < 300 ? "\u2713" : s < 400 ? "\u25CB" : "\u2717";
    console.log(`${icon} ${c.req.method} ${c.req.path} - ${s} (${ms}ms)`);
  });

  app.use("*", cors());

  // Routes
  const healthRoute = createRoute({
    method: "get",
    path: "/",
    tags: ["Health"],
    summary: "Health check",
    description: "Check if the service is running",
    responses: {
      200: {
        description: "Service is healthy",
        content: {
          "application/json": { schema: HealthCheckResponseSchema },
        },
      },
    },
  });

  app.openapi(healthRoute, (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  registerHelloRoute(app);
  registerCheckRoute(app, env);

  // kitn AI routes
  app.route("/api", ai.router);

  // API Documentation
  app.get("/openapi", (c) => {
    return c.json(
      app.getOpenAPIDocument({
        openapi: "3.1.0",
        info: {
          version: "1.0.0",
          title: "{{name}} API",
          description: "API documentation",
        },
        servers: [
          { url: `http://localhost:${env.PORT}`, description: "Development" },
        ],
      }),
    );
  });

  app.get(
    "/docs",
    Scalar({
      theme: "purple",
      pageTitle: "{{name}} API",
      url: "/openapi",
    }),
  );

  // Error handlers
  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  app.onError((err, c) => {
    console.error("API Error:", err);
    return c.json(
      {
        error: err.message || "Internal Server Error",
        ...(env.NODE_ENV === "development" && { stack: err.stack }),
      },
      500,
    );
  });

  return app;
}
