import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

function getConfig() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const endpoint = process.env.S3_ENDPOINT;
  if (!accessKeyId || !secretAccessKey || !endpoint) throw new Error("S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_ENDPOINT are required");
  return { accessKeyId, secretAccessKey, endpoint, region: process.env.S3_REGION ?? "auto" };
}

async function sign(method: string, url: string, headers: Record<string, string>, body?: string) {
  const config = getConfig();
  const u = new URL(url);
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  headers["x-amz-date"] = amzDate;
  headers["host"] = u.host;

  const signedHeaderKeys = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`).join("\n") + "\n";
  const payloadHash = body ? await sha256(body) : await sha256("");
  const canonicalRequest = [method, u.pathname, u.search.slice(1), canonicalHeaders, signedHeaderKeys, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join("\n");
  const signingKey = await getSigningKey(config.secretAccessKey, dateStamp, config.region);
  const signature = await hmacHex(signingKey, stringToSign);
  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderKeys}, Signature=${signature}`;
  return headers;
}

async function sha256(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacBytes(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  const sig = await hmacBytes(key, data);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getSigningKey(secret: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
  let key: ArrayBuffer = await hmacBytes(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
  key = await hmacBytes(key, region);
  key = await hmacBytes(key, "s3");
  key = await hmacBytes(key, "aws4_request");
  return key;
}

async function s3Fetch(method: string, bucket: string, key: string, body?: string) {
  const config = getConfig();
  const url = `${config.endpoint}/${bucket}/${key}`;
  const headers: Record<string, string> = {};
  if (body) headers["content-type"] = "application/octet-stream";
  await sign(method, url, headers, body);
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) throw new Error(`S3 error ${res.status}: ${await res.text()}`);
  return res;
}

export const s3ListTool = tool({
  description: "List objects in an S3-compatible bucket",
  inputSchema: z.object({
    bucket: z.string().describe("Bucket name"),
    prefix: z.string().default("").describe("Key prefix to filter by"),
    maxKeys: z.number().default(20),
  }),
  execute: async ({ bucket, prefix, maxKeys }) => {
    const config = getConfig();
    const url = `${config.endpoint}/${bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=${maxKeys}`;
    const headers: Record<string, string> = {};
    await sign("GET", url, headers);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`S3 list error ${res.status}: ${await res.text()}`);
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    const sizes = [...xml.matchAll(/<Size>(\d+)<\/Size>/g)].map((m) => parseInt(m[1]));
    return { bucket, prefix, objects: keys.map((k, i) => ({ key: k, size: sizes[i] })) };
  },
});

export const s3PresignTool = tool({
  description: "Generate a presigned URL for uploading or downloading an object from S3-compatible storage",
  inputSchema: z.object({
    bucket: z.string().describe("Bucket name"),
    key: z.string().describe("Object key"),
    action: z.enum(["upload", "download"]).describe("Whether the URL is for uploading (PUT) or downloading (GET)"),
    expiresIn: z.number().default(3600).describe("URL expiration time in seconds"),
    contentType: z.string().optional().describe("Content-Type for upload (e.g. image/png)"),
  }),
  execute: async ({ bucket, key, action, expiresIn, contentType }) => {
    const config = getConfig();
    const method = action === "upload" ? "PUT" : "GET";
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const queryParams = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expiresIn),
      "X-Amz-SignedHeaders": "host",
      ...(contentType ? { "Content-Type": contentType } : {}),
    });
    const url = `${config.endpoint}/${bucket}/${key}?${queryParams}`;
    const u = new URL(url);
    const canonicalRequest = [method, u.pathname, u.search.slice(1), `host:${u.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join("\n");
    const signingKey = await getSigningKey(config.secretAccessKey, dateStamp, config.region);
    const signature = await hmacHex(signingKey, stringToSign);
    return { presignedUrl: `${url}&X-Amz-Signature=${signature}`, method, expiresIn, bucket, key };
  },
});

registerTool({ name: "s3-list", description: "List objects in an S3-compatible bucket", inputSchema: z.object({ bucket: z.string(), prefix: z.string().default(""), maxKeys: z.number().default(20) }), tool: s3ListTool });
registerTool({ name: "s3-presign", description: "Generate a presigned URL for uploading or downloading from S3-compatible storage", inputSchema: z.object({ bucket: z.string(), key: z.string(), action: z.enum(["upload", "download"]), expiresIn: z.number().default(3600), contentType: z.string().optional() }), tool: s3PresignTool });
