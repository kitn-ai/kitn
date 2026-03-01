import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

async function cfBrowser(endpoint: string, body: unknown) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!accountId || !token) throw new Error("CF_ACCOUNT_ID and CF_API_TOKEN are required");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Browser Rendering error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const cfScreenshotTool = tool({
  description: "Take a screenshot of a web page using Cloudflare Browser Rendering",
  inputSchema: z.object({
    url: z.string().url().describe("URL to screenshot"),
    fullPage: z.boolean().default(false),
    width: z.number().default(1280),
    height: z.number().default(720),
  }),
  execute: async ({ url, fullPage, width, height }) => {
    const data = await cfBrowser("screenshot", { url, options: { fullPage, viewport: { width, height } } });
    return { screenshot: data.result, url };
  },
});

export const cfScrapeTool = tool({
  description: "Extract text content from a web page using Cloudflare Browser Rendering",
  inputSchema: z.object({
    url: z.string().url().describe("URL to scrape"),
    selector: z.string().optional().describe("CSS selector to extract specific content"),
    waitFor: z.string().optional().describe("CSS selector to wait for before extracting"),
  }),
  execute: async ({ url, selector, waitFor }) => {
    const data = await cfBrowser("content", { url, options: { selector, waitForSelector: waitFor } });
    return { content: data.result, url };
  },
});

registerTool({ name: "cf-screenshot", description: "Take a screenshot using Cloudflare Browser Rendering", inputSchema: z.object({ url: z.string().url(), fullPage: z.boolean().default(false), width: z.number().default(1280), height: z.number().default(720) }), tool: cfScreenshotTool });
registerTool({ name: "cf-scrape", description: "Extract text content from a web page using Cloudflare Browser Rendering", inputSchema: z.object({ url: z.string().url(), selector: z.string().optional(), waitFor: z.string().optional() }), tool: cfScrapeTool });
