import { tool } from "ai";
import { z } from "zod";

export const webFetchTool = tool({
  description: "Fetch the content of a URL. Returns text content (HTML stripped to plain text for readability).",
  inputSchema: z.object({
    url: z.string().url().describe("URL to fetch"),
    maxLength: z.number().default(10000).describe("Maximum characters to return"),
  }),
  execute: async ({ url, maxLength }) => {
    const response = await fetch(url, {
      headers: { "User-Agent": "KitnClaw/0.1" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { url, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();

    let content: string;
    if (contentType.includes("text/html")) {
      content = stripHtml(raw);
    } else {
      content = raw;
    }

    if (content.length > maxLength) {
      content = content.slice(0, maxLength) + "\n... (truncated)";
    }

    return { url, contentType, length: content.length, content };
  },
});

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
