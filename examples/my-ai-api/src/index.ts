import { env } from "./env.ts";
import { createApp } from "./app.ts";

const app = createApp(env);

console.log("═══════════════════════════════════════════════════════════");
console.log("  My AI API v1.0.0");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  Server:      http://localhost:${env.PORT}`);
console.log(`  Docs:        http://localhost:${env.PORT}/docs`);
console.log(`  OpenAPI:     http://localhost:${env.PORT}/openapi`);
console.log(`  Health:      http://localhost:${env.PORT}/health`);
console.log(`  Ping:        http://localhost:${env.PORT}/ping`);
console.log("═══════════════════════════════════════════════════════════");

export default {
  port: env.PORT,
  fetch: app.fetch,
};
