import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

async function cfAi(model: string, body: unknown) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!accountId || !token) throw new Error("CF_ACCOUNT_ID and CF_API_TOKEN are required");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Workers AI error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const cfTextGenTool = tool({
  description: "Generate text using Cloudflare Workers AI",
  inputSchema: z.object({
    prompt: z.string().describe("Input prompt"),
    model: z.string().default("@cf/meta/llama-3.1-8b-instruct").describe("Workers AI model ID"),
    maxTokens: z.number().default(256),
  }),
  execute: async ({ prompt, model, maxTokens }) => {
    const data = await cfAi(model, { messages: [{ role: "user", content: prompt }], max_tokens: maxTokens });
    return { response: data.result?.response ?? data.result, model };
  },
});

export const cfEmbeddingsTool = tool({
  description: "Generate text embeddings using Cloudflare Workers AI",
  inputSchema: z.object({
    text: z.union([z.string(), z.array(z.string())]).describe("Text or array of texts to embed"),
    model: z.string().default("@cf/baai/bge-base-en-v1.5").describe("Embedding model ID"),
  }),
  execute: async ({ text, model }) => {
    const data = await cfAi(model, { text: Array.isArray(text) ? text : [text] });
    return { embeddings: data.result?.data ?? data.result, model, dimensions: data.result?.data?.[0]?.length };
  },
});

registerTool({ name: "cf-text-generate", description: "Generate text using Cloudflare Workers AI", inputSchema: z.object({ prompt: z.string(), model: z.string().default("@cf/meta/llama-3.1-8b-instruct"), maxTokens: z.number().default(256) }), tool: cfTextGenTool });
registerTool({ name: "cf-embeddings", description: "Generate text embeddings using Cloudflare Workers AI", inputSchema: z.object({ text: z.union([z.string(), z.array(z.string())]), model: z.string().default("@cf/baai/bge-base-en-v1.5") }), tool: cfEmbeddingsTool });
