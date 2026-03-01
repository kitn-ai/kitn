import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

export const uuidGeneratorTool = tool({
  description: "Generate unique identifiers in various formats (UUID v4, UUID v7, nanoid)",
  inputSchema: z.object({
    format: z.enum(["uuidv4", "uuidv7", "nanoid"]).default("uuidv4").describe("ID format to generate"),
    count: z.number().min(1).max(20).default(1).describe("Number of IDs to generate"),
  }),
  execute: async ({ format, count }) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      switch (format) {
        case "uuidv4":
          ids.push(crypto.randomUUID());
          break;
        case "uuidv7": {
          // UUID v7: timestamp-based with random suffix
          const now = Date.now();
          const bytes = new Uint8Array(16);
          crypto.getRandomValues(bytes);
          // Set timestamp in first 48 bits
          bytes[0] = (now / 2 ** 40) & 0xff;
          bytes[1] = (now / 2 ** 32) & 0xff;
          bytes[2] = (now / 2 ** 24) & 0xff;
          bytes[3] = (now / 2 ** 16) & 0xff;
          bytes[4] = (now / 2 ** 8) & 0xff;
          bytes[5] = now & 0xff;
          // Set version (7) and variant (10)
          bytes[6] = (bytes[6] & 0x0f) | 0x70;
          bytes[8] = (bytes[8] & 0x3f) | 0x80;
          const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
          ids.push(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
          break;
        }
        case "nanoid": {
          const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
          const bytes = new Uint8Array(21);
          crypto.getRandomValues(bytes);
          ids.push([...bytes].map((b) => alphabet[b & 63]).join(""));
          break;
        }
      }
    }
    return { format, ids };
  },
});

registerTool({
  name: "uuid-generator",
  description: "Generate unique identifiers in various formats (UUID v4, UUID v7, nanoid)",
  inputSchema: z.object({
    format: z.enum(["uuidv4", "uuidv7", "nanoid"]).default("uuidv4"),
    count: z.number().min(1).max(20).default(1),
  }),
  tool: uuidGeneratorTool,
});
