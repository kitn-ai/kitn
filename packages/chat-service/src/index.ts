import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

const port = Number(process.env.PORT) || 4002;

console.log(`[chat-service] Running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
