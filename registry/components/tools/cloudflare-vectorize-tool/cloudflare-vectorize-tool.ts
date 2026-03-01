import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

async function cfVectorize(indexName: string, path: string, method = "GET", body?: unknown) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!accountId || !token) throw new Error("CF_ACCOUNT_ID and CF_API_TOKEN are required");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/v2/indexes/${indexName}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": body ? "application/json" : "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Vectorize error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const vectorQueryTool = tool({
  description: "Query a Cloudflare Vectorize index with a vector to find similar items",
  inputSchema: z.object({
    indexName: z.string().describe("Vectorize index name"),
    vector: z.array(z.number()).describe("Query vector"),
    topK: z.number().default(5).describe("Number of results to return"),
    returnMetadata: z.boolean().default(true),
  }),
  execute: async ({ indexName, vector, topK, returnMetadata }) => {
    const data = await cfVectorize(indexName, "/query", "POST", { vector, topK, returnMetadata: returnMetadata ? "all" : "none" });
    return { matches: data.result?.matches ?? [] };
  },
});

export const vectorUpsertTool = tool({
  description: "Insert or update vectors in a Cloudflare Vectorize index",
  inputSchema: z.object({
    indexName: z.string().describe("Vectorize index name"),
    vectors: z.array(z.object({
      id: z.string(),
      values: z.array(z.number()),
      metadata: z.record(z.string()).optional(),
    })).describe("Vectors to upsert"),
  }),
  execute: async ({ indexName, vectors }) => {
    const data = await cfVectorize(indexName, "/upsert", "POST", { vectors });
    return { mutationId: data.result?.mutationId, count: vectors.length };
  },
});

registerTool({ name: "vectorize-query", description: "Query a Cloudflare Vectorize index", inputSchema: z.object({ indexName: z.string(), vector: z.array(z.number()), topK: z.number().default(5), returnMetadata: z.boolean().default(true) }), tool: vectorQueryTool });
registerTool({ name: "vectorize-upsert", description: "Insert or update vectors in a Cloudflare Vectorize index", inputSchema: z.object({ indexName: z.string(), vectors: z.array(z.object({ id: z.string(), values: z.array(z.number()), metadata: z.record(z.string()).optional() })) }), tool: vectorUpsertTool });
