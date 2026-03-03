import { tool } from "ai";
import { z } from "zod";

export const webSearchTool = tool({
  description: "Search the web and return relevant results. Uses DuckDuckGo.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().default(5).describe("Maximum number of results"),
  }),
  execute: async ({ query, maxResults }) => {
    // DuckDuckGo HTML search — no API key required
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "KitnClaw/0.1",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { query, error: `Search failed: HTTP ${response.status}` };
    }

    const html = await response.text();
    const results = parseSearchResults(html, maxResults);

    return { query, resultCount: results.length, results };
  },
});

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseSearchResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];
  // DuckDuckGo HTML results are in <a class="result__a"> with <a class="result__snippet">
  const resultBlocks = html.split(/class="result__body"/);

  for (let i = 1; i < resultBlocks.length && results.length < max; i++) {
    const block = resultBlocks[i];

    // Extract title and URL from result__a link
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    let url = titleMatch[1];
    // DuckDuckGo wraps URLs in a redirect — extract the actual URL
    const udMatch = url.match(/uddg=([^&]+)/);
    if (udMatch) {
      url = decodeURIComponent(udMatch[1]);
    }

    const title = titleMatch[2].replace(/<[^>]+>/g, "").trim();

    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}
