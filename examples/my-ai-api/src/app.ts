import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { HealthResponseSchema, PingResponseSchema } from "./schemas.ts";
import type { Env } from "./env.ts";
import { createAIPlugin } from "@kitnai/hono";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { registerWithPlugin } from "./ai";

export function createApp(env: Env) {
  const app = new OpenAPIHono();

  // ===================================================================
  // MIDDLEWARE
  // ===================================================================

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    const status = c.res.status;
    const emoji = status < 300 ? "\u2713" : status >= 400 ? "\u2717" : "\u25CB";
    console.log(
      `${emoji} ${c.req.method} ${c.req.path} - ${status} (${duration}ms)`,
    );
  });

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Access-Control-Allow-Origin", "*");
    c.res.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    );
    c.res.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
  });

  // ===================================================================
  // ROUTES
  // ===================================================================

  const healthRoute = createRoute({
    method: "get",
    path: "/health",
    tags: ["Health"],
    summary: "Health check",
    description: "Check if the service is running and healthy",
    responses: {
      200: {
        description: "Service is healthy",
        content: { "application/json": { schema: HealthResponseSchema } },
      },
    },
  });

  app.openapi(healthRoute, (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  const pingRoute = createRoute({
    method: "get",
    path: "/ping",
    tags: ["Health"],
    summary: "Ping",
    description: "Simple ping/pong endpoint for connectivity checks",
    responses: {
      200: {
        description: "Pong",
        content: { "application/json": { schema: PingResponseSchema } },
      },
    },
  });

  const plugin = createAIPlugin({
    getModel: (id) => openrouter(id ?? "openai/gpt-4o-mini"),
  });

  registerWithPlugin(plugin);

  app.route("/api", plugin.app);

  app.openapi(pingRoute, (c) => {
    return c.json({ pong: true as const });
  });

  // ===================================================================
  // API DOCUMENTATION
  // ===================================================================

  app.get("/openapi", (c) => {
    return c.json(
      app.getOpenAPIDocument({
        openapi: "3.1.0",
        info: {
          version: "1.0.0",
          title: "My AI API",
          description: "AI-powered API service",
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
      pageTitle: "My AI API",
      url: "/openapi",
    }) as any,
  );

  // ===================================================================
  // ERROR HANDLERS
  // ===================================================================

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
