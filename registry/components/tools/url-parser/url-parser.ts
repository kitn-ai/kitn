import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const urlParserTool = tool({
  description: "Parse a URL into its components, build a URL from parts, or encode/decode URL strings",
  inputSchema: z.object({
    action: z.enum(["parse", "build", "encode", "decode"]).describe("Action to perform"),
    url: z.string().optional().describe("URL to parse or decode"),
    parts: z.object({
      protocol: z.string().optional(),
      hostname: z.string().optional(),
      port: z.string().optional(),
      pathname: z.string().optional(),
      search: z.string().optional(),
      hash: z.string().optional(),
    }).optional().describe("URL parts (for build action)"),
    text: z.string().optional().describe("Text to encode/decode"),
  }),
  execute: async ({ action, url, parts, text }) => {
    switch (action) {
      case "parse": {
        if (!url) return { error: "URL is required for parse action" };
        try {
          const u = new URL(url);
          const params = Object.fromEntries(u.searchParams.entries());
          return { protocol: u.protocol, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, hash: u.hash, origin: u.origin, searchParams: params };
        } catch {
          return { error: `Invalid URL: ${url}` };
        }
      }
      case "build": {
        if (!parts?.hostname) return { error: "hostname is required for build action" };
        const u = new URL(`${parts.protocol ?? "https:"}//${parts.hostname}`);
        if (parts.port) u.port = parts.port;
        if (parts.pathname) u.pathname = parts.pathname;
        if (parts.search) u.search = parts.search;
        if (parts.hash) u.hash = parts.hash;
        return { url: u.toString() };
      }
      case "encode":
        return { encoded: encodeURIComponent(text ?? url ?? "") };
      case "decode":
        return { decoded: decodeURIComponent(text ?? url ?? "") };
    }
  },
});

registerTool({
  name: "url-parser",
  description: "Parse a URL into its components, build a URL from parts, or encode/decode URL strings",
  inputSchema: z.object({
    action: z.enum(["parse", "build", "encode", "decode"]),
    url: z.string().optional(),
    parts: z.object({ protocol: z.string().optional(), hostname: z.string().optional(), port: z.string().optional(), pathname: z.string().optional(), search: z.string().optional(), hash: z.string().optional() }).optional(),
    text: z.string().optional(),
  }),
  tool: urlParserTool,
});
