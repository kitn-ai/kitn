import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^\- (.+)$/gm, "<li>$1</li>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[hlu])(.+)$/gm, "<p>$1</p>");
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const markdownConverterTool = tool({
  description: "Convert between Markdown, HTML, and plain text formats",
  inputSchema: z.object({
    text: z.string().describe("Input text to convert"),
    from: z.enum(["markdown", "html"]).describe("Source format"),
    to: z.enum(["html", "text"]).describe("Target format"),
  }),
  execute: async ({ text, from, to }) => {
    if (from === "markdown" && to === "html") return { result: markdownToHtml(text) };
    if (from === "html" && to === "text") return { result: htmlToText(text) };
    if (from === "markdown" && to === "text") return { result: htmlToText(markdownToHtml(text)) };
    return { result: text };
  },
});

registerTool({
  name: "markdown-converter",
  description: "Convert between Markdown, HTML, and plain text formats",
  inputSchema: z.object({ text: z.string(), from: z.enum(["markdown", "html"]), to: z.enum(["html", "text"]) }),
  tool: markdownConverterTool,
});
