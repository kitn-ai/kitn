import { tool } from "ai";
import { z } from "zod";
import { readFile, stat } from "fs/promises";

export const fileReadTool = tool({
  description: "Read the contents of a file at the given path",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative file path"),
    encoding: z.enum(["utf-8", "base64"]).default("utf-8").describe("File encoding"),
  }),
  execute: async ({ path, encoding }) => {
    const info = await stat(path);
    if (!info.isFile()) {
      return { error: `Not a file: ${path}` };
    }
    const content = await readFile(path, encoding as BufferEncoding);
    return { path, content, size: info.size };
  },
});
