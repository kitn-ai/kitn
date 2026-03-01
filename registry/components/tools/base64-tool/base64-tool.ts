import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const base64Tool = tool({
  description: "Encode text to base64/base64url or decode base64/base64url to text",
  inputSchema: z.object({
    action: z.enum(["encode", "decode"]).describe("Encode or decode"),
    text: z.string().describe("Text to encode or base64 string to decode"),
    urlSafe: z.boolean().default(false).describe("Use base64url (URL-safe) variant"),
  }),
  execute: async ({ action, text, urlSafe }) => {
    if (action === "encode") {
      const encoded = btoa(text);
      return { result: urlSafe ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : encoded };
    }
    const padded = urlSafe ? text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4) : text;
    try {
      return { result: atob(padded) };
    } catch {
      return { error: "Invalid base64 input" };
    }
  },
});

registerTool({
  name: "base64-tool",
  description: "Encode text to base64/base64url or decode base64/base64url to text",
  inputSchema: z.object({
    action: z.enum(["encode", "decode"]),
    text: z.string(),
    urlSafe: z.boolean().default(false),
  }),
  tool: base64Tool,
});
