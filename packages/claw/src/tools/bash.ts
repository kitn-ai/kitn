import { tool } from "ai";
import { z } from "zod";
import { spawn } from "child_process";

export const bashTool = tool({
  description: "Execute a shell command and return stdout/stderr. Use with caution.",
  inputSchema: z.object({
    command: z.string().describe("Shell command to execute"),
    cwd: z.string().optional().describe("Working directory"),
    timeout: z.number().default(30000).describe("Timeout in milliseconds"),
  }),
  execute: async ({ command, cwd, timeout }) => {
    return new Promise((resolve) => {
      const proc = spawn("sh", ["-c", command], {
        cwd: cwd ?? process.cwd(),
        timeout,
        env: { ...process.env },
      });

      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      proc.stdout.on("data", (data: Buffer) => chunks.push(data));
      proc.stderr.on("data", (data: Buffer) => errChunks.push(data));

      proc.on("close", (code) => {
        const stdout = Buffer.concat(chunks).toString("utf-8");
        const stderr = Buffer.concat(errChunks).toString("utf-8");
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });

      proc.on("error", (err) => {
        resolve({ exitCode: 1, stdout: "", stderr: err.message });
      });
    });
  },
});
