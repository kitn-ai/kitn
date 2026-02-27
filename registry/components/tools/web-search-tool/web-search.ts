import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

/**
 * Strip HTML tags and decode common HTML entities from a string.
 * Used to clean Brave Search descriptions which contain markup.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export const searchWebTool = tool({
  description:
    "Search the web using Brave Search. Returns a list of results with titles, URLs, and descriptions.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    count: z
      .number()
      .min(1)
      .max(10)
      .default(5)
      .describe("Number of results to return (1-10, default 5)"),
  }),
  execute: async ({ query, count }) => {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      throw new Error("BRAVE_API_KEY environment variable is required");
    }

    const params = new URLSearchParams({
      q: query,
      count: String(count ?? 5),
    });

    const res = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!res.ok) {
      throw new Error(`Brave Search failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const webResults = data.web?.results ?? [];

    return {
      query,
      resultCount: webResults.length,
      results: webResults.map(
        (r: {
          title: string;
          url: string;
          description: string;
          thumbnail?: { src: string };
        }) => ({
          title: stripHtml(r.title),
          url: r.url,
          description: stripHtml(r.description),
          ...(r.thumbnail?.src && { thumbnail: r.thumbnail.src }),
        })
      ),
    };
  },
});

registerTool({
  name: "web-search-tool",
  description:
    "Search the web using Brave Search. Returns a list of results with titles, URLs, and descriptions.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    count: z
      .number()
      .min(1)
      .max(10)
      .default(5)
      .describe("Number of results to return (1-10, default 5)"),
  }),
  tool: searchWebTool,
});
