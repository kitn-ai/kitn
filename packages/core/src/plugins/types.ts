import type { z } from "zod";
import type { PluginContext } from "../types.js";

/** Context passed to every plugin route handler */
export interface PluginHandlerContext {
  /** The raw Web Standard Request */
  request: Request;
  /** Route parameters (e.g. { id: "42" } for /items/:id) */
  params: Record<string, string>;
  /** Access to shared plugin context (agents, storage, model, hooks) */
  pluginContext: PluginContext;
}

/** HTTP method */
export type PluginRouteMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/** A single route definition */
export interface PluginRoute {
  method: PluginRouteMethod;
  path: string;
  handler: (ctx: PluginHandlerContext) => Promise<Response>;
  schema?: PluginRouteSchema;
}

/** Optional OpenAPI metadata for a route. Used by OpenAPI-aware adapters for documentation. */
export interface PluginRouteSchema {
  summary?: string;
  description?: string;
  tags?: string[];
  request?: {
    query?: z.ZodType;
    params?: z.ZodType;
    body?: { content: Record<string, { schema: z.ZodType }> };
  };
  responses?: Record<number, {
    description: string;
    content?: Record<string, { schema: z.ZodType }>;
  }>;
}

/** The plugin contract. Implement this to add routes to any kitn adapter. */
export interface KitnPlugin {
  /** Plugin name, used for discovery endpoint */
  name: string;
  /** URL prefix (e.g. "/voice"). Routes are mounted under this path. */
  prefix: string;
  /** Route definitions */
  routes: PluginRoute[];
  /** Optional initialization function, called after plugin context is ready */
  init?: (ctx: PluginContext) => void | Promise<void>;
}
