import { describe, test, expect } from "bun:test";
import type { KitnPlugin, PluginRoute, PluginHandlerContext, PluginRouteSchema } from "./types.js";

describe("KitnPlugin types", () => {
  test("a valid plugin satisfies the interface", () => {
    const plugin: KitnPlugin = {
      name: "test-plugin",
      prefix: "/test",
      routes: [
        {
          method: "GET",
          path: "/hello",
          handler: async (ctx: PluginHandlerContext) => {
            return Response.json({ message: "hello" });
          },
        },
      ],
    };
    expect(plugin.name).toBe("test-plugin");
    expect(plugin.prefix).toBe("/test");
    expect(plugin.routes).toHaveLength(1);
    expect(plugin.routes[0].method).toBe("GET");
  });

  test("plugin with init function", async () => {
    let initialized = false;
    const plugin: KitnPlugin = {
      name: "init-plugin",
      prefix: "/init",
      routes: [],
      init: async () => { initialized = true; },
    };
    expect(plugin.init).toBeDefined();
    await plugin.init!({} as any);
    expect(initialized).toBe(true);
  });

  test("route with schema metadata", () => {
    const route: PluginRoute = {
      method: "POST",
      path: "/speak",
      handler: async () => new Response("ok"),
      schema: {
        summary: "Text to speech",
        tags: ["Voice"],
        responses: {
          200: { description: "Audio stream" },
        },
      },
    };
    expect(route.schema?.summary).toBe("Text to speech");
    expect(route.schema?.tags).toEqual(["Voice"]);
  });

  test("handler receives request and params", async () => {
    const route: PluginRoute = {
      method: "GET",
      path: "/items/:id",
      handler: async (ctx) => {
        return Response.json({ id: ctx.params.id });
      },
    };
    const mockCtx: PluginHandlerContext = {
      request: new Request("http://localhost/items/42"),
      params: { id: "42" },
      pluginContext: {} as any,
    };
    const res = await route.handler(mockCtx);
    const data = await res.json();
    expect(data.id).toBe("42");
  });
});
