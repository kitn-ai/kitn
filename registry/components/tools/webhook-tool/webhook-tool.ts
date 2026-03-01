import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const webhookSendTool = tool({
  description: "Send an HTTP webhook callback to a URL with optional HMAC-SHA256 signature",
  inputSchema: z.object({
    url: z.string().url().describe("Webhook endpoint URL"),
    payload: z.record(z.unknown()).describe("JSON payload to send"),
    secret: z.string().optional().describe("HMAC-SHA256 signing secret (adds X-Webhook-Signature header)"),
    headers: z.record(z.string()).optional().describe("Additional HTTP headers"),
    method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
  }),
  execute: async ({ url, payload, secret, headers: extraHeaders, method }) => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
    if (secret) {
      const signature = await signPayload(body, secret);
      headers["X-Webhook-Signature"] = `sha256=${signature}`;
    }
    const res = await fetch(url, { method, headers, body });
    return { status: res.status, statusText: res.statusText, ok: res.ok, signed: !!secret };
  },
});

registerTool({ name: "webhook-send", description: "Send an HTTP webhook callback with optional HMAC-SHA256 signature", inputSchema: z.object({ url: z.string().url(), payload: z.record(z.unknown()), secret: z.string().optional(), headers: z.record(z.string()).optional(), method: z.enum(["POST", "PUT", "PATCH"]).default("POST") }), tool: webhookSendTool });
