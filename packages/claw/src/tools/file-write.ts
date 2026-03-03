import { tool } from "ai";
import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export const fileWriteTool = tool({
  description: "Write content to a file. Creates parent directories if needed.",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative file path"),
    content: z.string().describe("Content to write"),
    append: z.boolean().default(false).describe("Append instead of overwrite"),
  }),
  execute: async ({ path, content, append }) => {
    await mkdir(dirname(path), { recursive: true });
    if (append) {
      const { appendFile } = await import("fs/promises");
      await appendFile(path, content, "utf-8");
    } else {
      await writeFile(path, content, "utf-8");
    }
    return { path, bytesWritten: Buffer.byteLength(content, "utf-8"), appended: append };
  },
});
