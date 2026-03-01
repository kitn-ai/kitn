import { tool } from "ai";
import { z } from "zod";
import type { AIPluginInstance } from "@kitnai/hono-openapi-adapter";
import { env } from "../env.js";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export const searchWebTool = tool({
  description:
    "Search the web using Brave Search. Returns relevant web results including title, URL, and description.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    count: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("Number of results to return (1-10, default 5)"),
  }),
  execute: async ({ query, count }) => {
    const apiKey = env.BRAVE_API_KEY;
    if (!apiKey) {
      throw new Error("BRAVE_API_KEY is not set");
    }

    const params = new URLSearchParams({
      q: query,
      count: String(count),
    });

    const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Brave Search API failed: ${response.statusText}`);
    }

    const data = await response.json();
    const webResults = data.web?.results ?? [];

    const results = webResults.map((item: any) => {
      const result: {
        title: string;
        url: string;
        description: string;
        thumbnail?: string;
      } = {
        title: stripHtml(item.title ?? ""),
        url: item.url ?? "",
        description: stripHtml(item.description ?? ""),
      };
      if (item.thumbnail?.src) {
        result.thumbnail = item.thumbnail.src;
      }
      return result;
    });

    return {
      query,
      resultCount: results.length,
      results,
    };
  },
});

export function registerWebSearchTool(plugin: AIPluginInstance) {
  plugin.tools.register({
    name: "searchWeb",
    description: "Search the web using Brave Search",
    inputSchema: z.object({
      query: z.string(),
      count: z.number().int().min(1).max(10).default(5),
    }),
    tool: searchWebTool,
    directExecute: async (input) =>
      searchWebTool.execute!(
        { query: input.query, count: input.count ?? 5 },
        { toolCallId: "direct" } as any,
      ),
    category: "search",
  });
}
