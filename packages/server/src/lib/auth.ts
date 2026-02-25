import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

/** Creates a simple API key auth middleware for Hono */
export function createApiKeyAuth(apiKey: string) {
  return createMiddleware(async (c, next) => {
    const key = c.req.header("X-API-Key");
    if (!key || key !== apiKey) {
      throw new HTTPException(401, { message: "Invalid or missing API key" });
    }
    await next();
  });
}
