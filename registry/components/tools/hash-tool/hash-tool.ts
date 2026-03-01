import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

const encoder = new TextEncoder();

async function hash(algorithm: string, data: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(algorithm, encoder.encode(data));
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(algorithm: string, key: string, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: algorithm }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ALGO_MAP: Record<string, string> = { "sha-256": "SHA-256", "sha-512": "SHA-512", "md5": "MD5" };

export const hashTool = tool({
  description: "Compute cryptographic hashes (SHA-256, SHA-512, MD5) or HMAC signatures",
  inputSchema: z.object({
    text: z.string().describe("Text to hash"),
    algorithm: z.enum(["sha-256", "sha-512", "md5"]).default("sha-256").describe("Hash algorithm"),
    hmacKey: z.string().optional().describe("If provided, compute HMAC instead of plain hash"),
  }),
  execute: async ({ text, algorithm, hmacKey }) => {
    const algo = ALGO_MAP[algorithm] ?? "SHA-256";
    const result = hmacKey ? await hmac(algo, hmacKey, text) : await hash(algo, text);
    return { algorithm, hash: result, isHmac: !!hmacKey };
  },
});

registerTool({
  name: "hash-tool",
  description: "Compute cryptographic hashes (SHA-256, SHA-512, MD5) or HMAC signatures",
  inputSchema: z.object({
    text: z.string(),
    algorithm: z.enum(["sha-256", "sha-512", "md5"]).default("sha-256"),
    hmacKey: z.string().optional(),
  }),
  tool: hashTool,
});
