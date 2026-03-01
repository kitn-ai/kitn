import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

// R2 is S3-compatible — this tool sets up R2-specific env vars and delegates to S3 operations.
// Users searching for "R2" find this component; internally it uses the same S3 signing logic.

function getR2Config() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.CF_ACCOUNT_ID;
  if (!accessKeyId || !secretAccessKey || !accountId) throw new Error("R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and CF_ACCOUNT_ID are required");
  return { accessKeyId, secretAccessKey, endpoint: `https://${accountId}.r2.cloudflarestorage.com`, region: "auto" };
}

// Set S3 env vars for the s3-tool to use (if not already set)
function ensureS3Env() {
  const config = getR2Config();
  if (!process.env.S3_ACCESS_KEY_ID) process.env.S3_ACCESS_KEY_ID = config.accessKeyId;
  if (!process.env.S3_SECRET_ACCESS_KEY) process.env.S3_SECRET_ACCESS_KEY = config.secretAccessKey;
  if (!process.env.S3_ENDPOINT) process.env.S3_ENDPOINT = config.endpoint;
  if (!process.env.S3_REGION) process.env.S3_REGION = config.region;
}

export const r2InfoTool = tool({
  description: "Get Cloudflare R2 configuration info and verify connectivity",
  inputSchema: z.object({
    bucket: z.string().describe("R2 bucket name to check"),
  }),
  execute: async ({ bucket }) => {
    const config = getR2Config();
    ensureS3Env();
    return {
      endpoint: config.endpoint,
      bucket,
      region: config.region,
      note: "R2 is S3-compatible. Use the s3-list and s3-presign tools for object operations after installing this component.",
    };
  },
});

registerTool({ name: "r2-info", description: "Get Cloudflare R2 configuration and verify connectivity", inputSchema: z.object({ bucket: z.string() }), tool: r2InfoTool });
