import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

const MAX_CONTENT_LENGTH = 4000;
const FETCH_TIMEOUT_MS = 10000;

/**
 * Strip HTML tags and extract readable text.
 * Lightweight regex-based approach -- no external deps.
 */
function htmlToText(html: string): string {
  return html
    // Remove script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Convert common block elements to newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    // Trim each line so whitespace-only lines become truly empty
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    // Collapse multiple blank lines into one
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract <title> from HTML.
 */
function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

/**
 * Extract OpenGraph meta tags from the <head> section.
 * Handles both property= and name= attributes (some sites use name="og:..."),
 * and any attribute ordering.
 */
function extractOpenGraph(html: string): Record<string, string> {
  const og: Record<string, string> = {};
  // Only look in <head> to avoid false matches in body
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : html.slice(0, 5000);

  // Match all <meta> tags, then inspect attributes individually
  const metaTagRegex = /<meta\s[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = metaTagRegex.exec(head)) !== null) {
    const tag = tagMatch[0];

    // Look for og: in either property= or name= attribute
    const ogKeyMatch =
      tag.match(/(?:property|name)=["']og:([^"']+)["']/i);
    const contentMatch = tag.match(/content=["']([^"']*)["']/i);

    if (ogKeyMatch && contentMatch) {
      const key = ogKeyMatch[1];
      if (!og[key]) {
        og[key] = contentMatch[1];
      }
    }
  }

  return og;
}

export const fetchPageTool = tool({
  description:
    "Fetch a web page and extract its readable text content. Use this to get detailed information from a specific URL found via search.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL of the page to fetch"),
  }),
  execute: async ({ url }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AIAgentBot/1.0)",
          Accept: "text/html,application/xhtml+xml,*/*",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      if (!res.ok) {
        throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      }

      const html = await res.text();
      const title = extractTitle(html);
      let content = htmlToText(html);
      const fullLength = content.length;

      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated]";
      }

      return {
        url,
        title: title ?? "Untitled",
        content,
        contentLength: fullLength,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});

registerTool({
  name: "web-fetch-tool",
  description:
    "Fetch a web page and extract its readable text content. Use this to get detailed information from a specific URL found via search.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL of the page to fetch"),
  }),
  tool: fetchPageTool,
});

export const getPageMetaTool = tool({
  description:
    "Extract OpenGraph metadata from a web page for rich card display. Returns structured data including title, description, image URL, and site name.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to extract OpenGraph metadata from"),
  }),
  execute: async ({ url }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AIAgentBot/1.0)",
          Accept: "text/html,application/xhtml+xml,*/*",
        },
        signal: controller.signal,
        redirect: "follow",
      });

      if (!res.ok) {
        throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      }

      const html = await res.text();
      const og = extractOpenGraph(html);
      const title = extractTitle(html);

      return {
        url,
        openGraph: {
          title: og.title ?? title ?? null,
          description: og.description ?? null,
          image: og.image ?? null,
          url: og.url ?? url,
          siteName: og.site_name ?? null,
          type: og.type ?? null,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});

registerTool({
  name: "web-fetch-meta-tool",
  description:
    "Extract OpenGraph metadata from a web page for rich card display. Returns structured data including title, description, image URL, and site name.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to extract OpenGraph metadata from"),
  }),
  tool: getPageMetaTool,
});
