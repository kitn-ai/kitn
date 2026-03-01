import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const pdfGeneratorTool = tool({
  description: "Generate a PDF from a URL or HTML content",
  inputSchema: z.object({
    url: z.string().url().optional().describe("URL to convert to PDF"),
    html: z.string().optional().describe("HTML content to convert to PDF (used if url is not provided)"),
    format: z.enum(["A4", "Letter", "Legal"]).default("A4"),
    landscape: z.boolean().default(false),
  }),
  execute: async ({ url, html, format, landscape }) => {
    const key = process.env.SCREENSHOTONE_API_KEY;
    if (!key) throw new Error("SCREENSHOTONE_API_KEY environment variable is required");
    if (!url && !html) throw new Error("Either url or html must be provided");
    const params = new URLSearchParams({
      access_key: key,
      ...(url ? { url } : { html: html! }),
      output: "pdf",
      pdf_paper_format: format.toLowerCase(),
      pdf_landscape: String(landscape),
      response_type: "json",
    });
    const res = await fetch(`https://api.screenshotone.com/take?${params}`);
    if (!res.ok) throw new Error(`PDF generation error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { pdfUrl: data.store?.location ?? data.url, format, landscape };
  },
});

registerTool({ name: "pdf-generate", description: "Generate a PDF from a URL or HTML content", inputSchema: z.object({ url: z.string().url().optional(), html: z.string().optional(), format: z.enum(["A4", "Letter", "Legal"]).default("A4"), landscape: z.boolean().default(false) }), tool: pdfGeneratorTool });
