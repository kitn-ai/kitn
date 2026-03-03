import { env } from "./env.js";
import { createApp } from "./app.js";

const app = createApp(env);

console.log("");
console.log("\u2550".repeat(59));
console.log("  {{name}}");
console.log("\u2550".repeat(59));
console.log(`  Server:      http://localhost:${env.PORT}`);
console.log(`  Docs:        http://localhost:${env.PORT}/docs`);
console.log(`  OpenAPI:     http://localhost:${env.PORT}/openapi`);
console.log(`  AI API:      http://localhost:${env.PORT}/api`);
console.log("\u2550".repeat(59));
console.log("");

export default {
  port: env.PORT,
  fetch: app.fetch,
};
