import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const screenshotTool = tool({
  description: "Capture a screenshot of a web page",
  inputSchema: z.object({
    url: z.string().url().describe("URL of the page to screenshot"),
    fullPage: z.boolean().default(false).describe("Capture the full scrollable page"),
    width: z.number().default(1280).describe("Viewport width in pixels"),
    format: z.enum(["png", "jpeg", "webp"]).default("png"),
  }),
  execute: async ({ url, fullPage, width, format }) => {
    const key = process.env.SCREENSHOTONE_API_KEY;
    if (!key) throw new Error("SCREENSHOTONE_API_KEY environment variable is required");
    const params = new URLSearchParams({ access_key: key, url, full_page: String(fullPage), viewport_width: String(width), format, response_type: "json" });
    const res = await fetch(`https://api.screenshotone.com/take?${params}`);
    if (!res.ok) throw new Error(`ScreenshotOne API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { url: data.store?.location ?? data.url, originalUrl: url, format };
  },
});

registerTool({ name: "screenshot", description: "Capture a screenshot of a web page", inputSchema: z.object({ url: z.string().url(), fullPage: z.boolean().default(false), width: z.number().default(1280), format: z.enum(["png", "jpeg", "webp"]).default("png") }), tool: screenshotTool });
