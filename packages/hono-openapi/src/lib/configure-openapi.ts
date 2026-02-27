import type { OpenAPIHono } from "@hono/zod-openapi";

export interface OpenAPIConfig {
  title?: string;
  version?: string;
  description?: string;
  serverUrl?: string;
}

export function configureOpenAPI(app: OpenAPIHono, config: OpenAPIConfig = {}) {
  const {
    title = "AI Plugin API",
    version = "1.0.0",
    description = "AI agent framework API",
    serverUrl,
  } = config;

  app.openAPIRegistry.registerComponent("securitySchemes", "ApiKeyAuth", {
    type: "apiKey",
    in: "header",
    name: "X-API-Key",
    description: "API key required for all routes",
  });

  const servers = serverUrl
    ? [{ url: serverUrl, description: "Server" }]
    : [];

  app.doc("/doc", {
    openapi: "3.1.0",
    info: { title, version, description },
    ...(servers.length > 0 && { servers }),
    security: [{ ApiKeyAuth: [] }],
  });
}
