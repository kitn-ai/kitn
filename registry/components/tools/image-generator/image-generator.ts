import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const imageGeneratorTool = tool({
  description: "Generate an image from a text prompt using OpenAI DALL-E",
  inputSchema: z.object({
    prompt: z.string().describe("Description of the image to generate"),
    size: z.enum(["1024x1024", "1024x1792", "1792x1024"]).default("1024x1024").describe("Image dimensions"),
    quality: z.enum(["standard", "hd"]).default("standard"),
    style: z.enum(["vivid", "natural"]).default("vivid"),
  }),
  execute: async ({ prompt, size, quality, style }) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY environment variable is required");
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size, quality, style, response_format: "url" }),
    });
    if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { url: data.data[0].url, revisedPrompt: data.data[0].revised_prompt, size };
  },
});

registerTool({ name: "image-generate", description: "Generate an image from a text prompt using OpenAI DALL-E", inputSchema: z.object({ prompt: z.string(), size: z.enum(["1024x1024", "1024x1792", "1792x1024"]).default("1024x1024"), quality: z.enum(["standard", "hd"]).default("standard"), style: z.enum(["vivid", "natural"]).default("vivid") }), tool: imageGeneratorTool });
