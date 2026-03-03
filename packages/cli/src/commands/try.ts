import * as p from "@clack/prompts";
import pc from "picocolors";
import { spawn } from "child_process";
import { writeFile, mkdir, unlink } from "fs/promises";
import { join, dirname } from "path";
import { createInterface } from "readline";
import {
  getTryContext,
  getRunnerCommand,
  generateRunnerScript,
  RUNNER_PATH,
} from "@kitnai/cli-core";
import type {
  TryListResult,
  AgentChatResponse,
  FieldInfo,
} from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spawn the runner script with a JSON command and read a single JSON line
 * from stdout. Returns the parsed result.
 */
function spawnRunner(
  cwd: string,
  runtimeCmd: string[],
  runnerPath: string,
  command: Record<string, unknown>,
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
        // Filter out noisy registration log lines from stderr
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
  });
}

/**
 * Prompt the user for tool parameters based on the schema.
 */
async function promptForParams(
  schema: Record<string, FieldInfo>,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(schema)) {
    const label = field.description ? `${key} ${pc.dim(`(${field.description})`)}` : key;
    const hint = !field.required
      ? field.default !== undefined
        ? `default: ${JSON.stringify(field.default)}`
        : "optional"
      : undefined;

    switch (field.type) {
      case "boolean": {
        const val = await p.confirm({
          message: label,
          initialValue: field.default === true,
        });
        if (p.isCancel(val)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }
        input[key] = val;
        break;
      }

      case "enum": {
        const options = (field.options ?? []).map((o) => ({
          value: o,
          label: o,
        }));
        const val = await p.select({
          message: label,
          options,
        });
        if (p.isCancel(val)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }
        input[key] = val;
        break;
      }

      case "number": {
        const val = await p.text({
          message: label,
          placeholder: hint,
          validate: (v) => {
            if (!field.required && v === "") return;
            if (isNaN(Number(v))) return "Must be a number";
          },
        });
        if (p.isCancel(val)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }
        if (val !== "" && val !== undefined) {
          input[key] = Number(val);
        } else if (field.default !== undefined) {
          input[key] = field.default;
        }
        break;
      }

      default: {
        // string, object, array, unknown — all as text input
        const val = await p.text({
          message: label,
          placeholder: hint,
          validate: (v) => {
            if (field.required && v === "") return "Required";
          },
        });
        if (p.isCancel(val)) {
          p.cancel("Cancelled.");
          process.exit(0);
        }
        if (val !== "" && val !== undefined) {
          // Try parsing JSON for object/array types
          if (field.type === "object" || field.type === "array") {
            try {
              input[key] = JSON.parse(val);
            } catch {
              input[key] = val;
            }
          } else {
            input[key] = val;
          }
        } else if (field.default !== undefined) {
          input[key] = field.default;
        }
        break;
      }
    }
  }

  return input;
}

/**
 * Pretty-print a JSON result with colors.
 */
function formatResult(result: unknown): string {
  const json = JSON.stringify(result, null, 2);
  // Colorize JSON: keys in cyan, strings in green, numbers in yellow
  return json
    .replace(/"([^"]+)":/g, `${pc.cyan('"$1"')}:`)
    .replace(/: "([^"]*)"/g, `: ${pc.green('"$1"')}`)
    .replace(/: (\d+\.?\d*)/g, `: ${pc.yellow("$1")}`);
}

// ---------------------------------------------------------------------------
// Tool mode
// ---------------------------------------------------------------------------

async function runToolMode(
  cwd: string,
  runtimeCmd: string[],
  runnerPath: string,
  toolName: string,
  schema: Record<string, FieldInfo>,
) {
  let runAgain = true;
  while (runAgain) {
    // Prompt for parameters
    const input = await promptForParams(schema);

    const s = p.spinner();
    s.start(`Running ${toolName}...`);

    try {
      const raw = await spawnRunner(cwd, runtimeCmd, runnerPath, {
        cmd: "exec-tool",
        name: toolName,
        input,
      });
      const parsed = JSON.parse(raw);
      s.stop(`${pc.green("Result:")}`);
      console.log();
      console.log(formatResult(parsed.result));
      console.log();
    } catch (err: any) {
      s.stop(pc.red("Failed"));
      p.log.error(err.message);
    }

    const again = await p.confirm({
      message: "Run again?",
      initialValue: false,
    });
    if (p.isCancel(again) || !again) {
      runAgain = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Agent mode
// ---------------------------------------------------------------------------

async function runAgentMode(
  cwd: string,
  runtimeCmd: string[],
  runnerPath: string,
  agentName: string,
  toolNames: string[],
) {
  console.log();
  p.log.info(`Connected to ${pc.bold(agentName)}`);
  if (toolNames.length > 0) {
    p.log.message(pc.dim(`Tools: ${toolNames.join(", ")}`));
  }
  console.log(pc.dim("  Type your message. Enter 'exit' or Ctrl+C to quit.\n"));

  // Spawn persistent runner process
  const args = [
    ...runtimeCmd.slice(1),
    runnerPath,
    JSON.stringify({ cmd: "agent-chat", name: agentName }),
  ];
  const child = spawn(runtimeCmd[0], args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  // Create readline for runner stdout (line-delimited JSON responses)
  const runnerRl = createInterface({ input: child.stdout, terminal: false });
  const responseQueue: Array<(line: string) => void> = [];

  runnerRl.on("line", (line) => {
    const resolver = responseQueue.shift();
    if (resolver) resolver(line);
  });

  // Collect stderr
  let runnerStderr = "";
  child.stderr.on("data", (data: Buffer) => {
    runnerStderr += data.toString();
  });

  function waitForResponse(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Response timeout"));
      }, 120_000);

      responseQueue.push((line) => {
        clearTimeout(timeout);
        resolve(line);
      });

      // If child exits before responding
      child.once("close", () => {
        clearTimeout(timeout);
        reject(new Error(runnerStderr.trim() || "Runner process exited"));
      });
    });
  }

  // Create readline for user input
  const userRl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const promptUser = (): Promise<string | null> =>
    new Promise((resolve) => {
      userRl.question(`${pc.bold("You:")} `, (answer) => resolve(answer));
      userRl.once("close", () => resolve(null));
    });

  try {
    while (true) {
      const userInput = await promptUser();

      if (userInput === null || userInput.trim() === "" || userInput.trim().toLowerCase() === "exit") {
        break;
      }

      // Send message to runner
      child.stdin.write(userInput.trim() + "\n");

      // Wait for response
      const s = p.spinner();
      s.start("Thinking...");

      try {
        const responseLine = await waitForResponse();
        s.stop("");
        const response: AgentChatResponse = JSON.parse(responseLine);

        // Show tool calls
        for (const tc of response.toolCalls) {
          const inputSummary = Object.keys(tc.input).length > 0
            ? `(${JSON.stringify(tc.input)})`
            : "()";
          console.log(`  ${pc.dim(`> ${tc.tool}${inputSummary}`)}`);
        }

        // Show agent response
        console.log(`\n${pc.bold("Agent:")} ${response.text}\n`);
      } catch (err: any) {
        s.stop(pc.red("Error"));
        p.log.error(err.message);
        break;
      }
    }
  } finally {
    userRl.close();
    child.stdin.end();
    child.kill();
  }

  console.log(pc.dim("\nSession ended"));
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function tryCommand(name?: string) {
  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  const ctx = await getTryContext(cwd);
  const runtimeCmd = getRunnerCommand(ctx.runtime);
  const runnerFullPath = join(cwd, RUNNER_PATH);

  // Write runner script
  await mkdir(dirname(runnerFullPath), { recursive: true });
  await writeFile(runnerFullPath, generateRunnerScript(ctx.baseDir));

  try {
    // List available tools and agents
    const s = p.spinner();
    s.start("Loading tools and agents...");

    let listResult: TryListResult;
    try {
      const raw = await spawnRunner(cwd, runtimeCmd, runnerFullPath, { cmd: "list" });
      listResult = JSON.parse(raw);
      s.stop(`Found ${listResult.tools.length} tool(s) and ${listResult.agents.length} agent(s)`);
    } catch (err: any) {
      s.stop(pc.red("Failed to load"));
      p.log.error(err.message);
      process.exit(1);
    }

    if (listResult.tools.length === 0 && listResult.agents.length === 0) {
      p.log.warn("No tools or agents found. Add some with `kitn add`.");
      process.exit(0);
    }

    // Determine selection
    let selectedName = name;
    let selectedType: "tool" | "agent" | undefined;

    if (selectedName) {
      // Check if the given name matches a tool or agent
      const tool = listResult.tools.find((t) => t.name === selectedName);
      const agent = listResult.agents.find((a) => a.name === selectedName);
      if (tool) {
        selectedType = "tool";
      } else if (agent) {
        selectedType = "agent";
      } else {
        p.log.error(`"${selectedName}" is not a registered tool or agent.`);
        const available = [
          ...listResult.tools.map((t) => t.name),
          ...listResult.agents.map((a) => a.name),
        ];
        p.log.message(pc.dim(`Available: ${available.join(", ")}`));
        process.exit(1);
      }
    } else {
      // Interactive selection
      const options: Array<{ value: string; label: string; hint?: string }> = [];
      for (const t of listResult.tools) {
        options.push({
          value: `tool:${t.name}`,
          label: t.name,
          hint: `tool — ${t.description}`,
        });
      }
      for (const a of listResult.agents) {
        options.push({
          value: `agent:${a.name}`,
          label: a.name,
          hint: `agent — ${a.description}`,
        });
      }

      const selected = await p.select({
        message: "What would you like to try?",
        options,
      });

      if (p.isCancel(selected)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      const [type, ...nameParts] = (selected as string).split(":");
      selectedType = type as "tool" | "agent";
      selectedName = nameParts.join(":");
    }

    // Run the appropriate mode
    if (selectedType === "tool") {
      const tool = listResult.tools.find((t) => t.name === selectedName)!;
      await runToolMode(cwd, runtimeCmd, runnerFullPath, tool.name, tool.schema);
    } else {
      const agent = listResult.agents.find((a) => a.name === selectedName)!;
      await runAgentMode(
        cwd,
        runtimeCmd,
        runnerFullPath,
        agent.name,
        agent.toolNames,
      );
    }
  } finally {
    // Clean up runner script
    try {
      await unlink(runnerFullPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}
