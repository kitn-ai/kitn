import type { AgentRequest } from "@kitnai/core";

interface ElysiaRequestContext {
  body: unknown;
  query: Record<string, string | undefined>;
  params: Record<string, string>;
  headers: Record<string, string | undefined>;
  request: Request;
}

/** Converts an Elysia handler context into the framework-agnostic AgentRequest interface */
export function toAgentRequest(ctx: ElysiaRequestContext): AgentRequest {
  return {
    json: async <T>() => ctx.body as T,
    query: (key: string) => ctx.query[key],
    param: (key: string) => ctx.params[key],
    header: (key: string) => ctx.headers[key],
    raw: ctx.request,
  };
}
