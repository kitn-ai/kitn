import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn } from "child_process";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join, dirname } from "path";
import {
  getTryContext,
  getRunnerCommand,
  generateRunnerScript,
  RUNNER_PATH,
} from "@kitnai/cli-core";
import { registerTool } from "../register-tool.js";

/**
 * Spawn the runner script, send a command, and return stdout.
 */
function spawnRunner(
  cwd: string,
  runtimeCmd: string[],
  runnerPath: string,
  command: Record<string, unknown>,
  stdinData?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [...runtimeCmd.slice(1), runnerPath, JSON.stringify(command)];
    const child = spawn(runtimeCmd[0], args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const errorLines = stderr
          .split("\n")
          .filter((l) => !l.startsWith("[ai] Registered"))
          .join("\n")
          .trim();
        reject(new Error(errorLines || `Runner exited with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start runner: ${err.message}`));
    });

    if (stdinData !== undefined) {
      child.stdin.write(stdinData + "\n");
      child.stdin.end();
    }
  });
}

/**
 * Write the runner script, execute a callback, then clean up.
 */
async function withRunner<T>(
  cwd: string,
  fn: (runtimeCmd: string[], runnerFullPath: string) => Promise<T>,
): Promise<T> {
  const ctx = await getTryContext(cwd);
  const runtimeCmd = getRunnerCommand(ctx.runtime);
  const runnerFullPath = join(cwd, RUNNER_PATH);

  await mkdir(dirname(runnerFullPath), { recursive: true });
  await writeFile(runnerFullPath, generateRunnerScript(ctx.baseDir));

  try {
    return await fn(runtimeCmd, runnerFullPath);
  } finally {
    try {
      await unlink(runnerFullPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export function registerTryTools(server: McpServer) {
  // ── kitn_try_tool ──
  registerTool<{ cwd: string; name: string; input: Record<string, unknown> }>(
    server,
    "kitn_try_tool",
    {
      description:
        "Execute a kitn tool with the given input parameters and return its result. Use kitn_list first to discover available tools and their schemas.",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
        name: z.string().describe("Tool name to execute"),
        input: z
          .record(z.any())
          .describe("Input parameters as a JSON object matching the tool's schema"),
      },
    },
    async ({ cwd, name, input }) => {
      try {
        const result = await withRunner(cwd, async (runtimeCmd, runnerPath) => {
          const raw = await spawnRunner(cwd, runtimeCmd, runnerPath, {
            cmd: "exec-tool",
            name,
            input,
          });
          return JSON.parse(raw);
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result.result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // ── kitn_try_agent ──
  registerTool<{ cwd: string; name: string; prompt: string }>(
    server,
    "kitn_try_agent",
    {
      description:
        "Send a single prompt to a kitn agent and return its response with tool call details. Use kitn_list first to discover available agents.",
      inputSchema: {
        cwd: z.string().describe("Project working directory"),
        name: z.string().describe("Agent name to chat with"),
        prompt: z.string().describe("Message to send to the agent"),
      },
    },
    async ({ cwd, name, prompt }) => {
      try {
        const result = await withRunner(cwd, async (runtimeCmd, runnerPath) => {
          const raw = await spawnRunner(
            cwd,
            runtimeCmd,
            runnerPath,
            { cmd: "agent-chat", name },
            prompt,
          );
          return JSON.parse(raw);
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
