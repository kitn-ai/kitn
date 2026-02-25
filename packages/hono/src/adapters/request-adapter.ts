import type { Context } from "hono";
import type { AgentRequest } from "@kitnai/core";

/** Converts a Hono Context into the framework-agnostic AgentRequest interface */
export function toAgentRequest(c: Context): AgentRequest {
  return {
    json: <T>() => c.req.json<T>(),
    query: (key: string) => c.req.query(key),
    param: (key: string) => c.req.param(key),
    header: (key: string) => c.req.header(key),
    raw: c.req.raw,
  };
}
