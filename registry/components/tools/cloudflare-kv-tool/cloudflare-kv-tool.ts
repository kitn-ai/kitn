import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

async function cfKv(path: string, method = "GET", body?: unknown) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!accountId || !token) throw new Error("CF_ACCOUNT_ID and CF_API_TOKEN are required");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  if (!res.ok) throw new Error(`Cloudflare KV error ${res.status}: ${await res.text()}`);
  return res.json();
}

export const kvGetTool = tool({
  description: "Get a value from Cloudflare Workers KV",
  inputSchema: z.object({
    namespaceId: z.string().describe("KV namespace ID"),
    key: z.string().describe("Key to retrieve"),
  }),
  execute: async ({ namespaceId, key }) => {
    const data = await cfKv(`/${namespaceId}/values/${encodeURIComponent(key)}`);
    return { key, value: data };
  },
});

export const kvPutTool = tool({
  description: "Write a value to Cloudflare Workers KV",
  inputSchema: z.object({
    namespaceId: z.string().describe("KV namespace ID"),
    key: z.string().describe("Key to write"),
    value: z.string().describe("Value to store"),
    expirationTtl: z.number().optional().describe("TTL in seconds"),
  }),
  execute: async ({ namespaceId, key, value, expirationTtl }) => {
    await cfKv(`/${namespaceId}/values/${encodeURIComponent(key)}${expirationTtl ? `?expiration_ttl=${expirationTtl}` : ""}`, "PUT", value);
    return { success: true, key };
  },
});

export const kvListTool = tool({
  description: "List keys in a Cloudflare Workers KV namespace",
  inputSchema: z.object({
    namespaceId: z.string().describe("KV namespace ID"),
    prefix: z.string().optional().describe("Key prefix filter"),
    limit: z.number().default(25),
  }),
  execute: async ({ namespaceId, prefix, limit }) => {
    const params = new URLSearchParams({ limit: String(limit), ...(prefix ? { prefix } : {}) });
    const data = await cfKv(`/${namespaceId}/keys?${params}`);
    return { keys: data.result };
  },
});

registerTool({ name: "kv-get", description: "Get a value from Cloudflare Workers KV", inputSchema: z.object({ namespaceId: z.string(), key: z.string() }), tool: kvGetTool });
registerTool({ name: "kv-put", description: "Write a value to Cloudflare Workers KV", inputSchema: z.object({ namespaceId: z.string(), key: z.string(), value: z.string(), expirationTtl: z.number().optional() }), tool: kvPutTool });
registerTool({ name: "kv-list", description: "List keys in a Cloudflare Workers KV namespace", inputSchema: z.object({ namespaceId: z.string(), prefix: z.string().optional(), limit: z.number().default(25) }), tool: kvListTool });
