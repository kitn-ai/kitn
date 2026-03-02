import pc from "picocolors";
import { listConversations, exportConversation } from "./storage.js";

export interface SlashCommandDef {
  name: string;
  description: string;
  section: "session" | "cli";
}

export type SlashCommandResult =
  | { type: "message"; content: string }
  | { type: "interactive"; command: "resume" }
  | { type: "cli"; args: string[]; mutating: boolean }
  | { type: "exit" }
  | { type: "noop" };

export function isSlashCommand(text: string): boolean {
  return text.startsWith("/");
}

const SESSION_COMMANDS: Record<string, string> = {
  "/resume": "Resume a previous conversation",
  "/compact": "Compact conversation history",
  "/export": "Export conversation to markdown",
  "/history": "Show recent conversations",
  "/clear": "Clear current conversation",
  "/exit": "Exit the REPL",
};

const CLI_COMMANDS: Record<string, string> = {
  "/init": "Initialize kitn in this project",
  "/add": "Add components (e.g. /add weather-agent)",
  "/remove": "Remove a component",
  "/list": "List available components",
  "/info": "Show component details",
  "/update": "Update components",
  "/link": "Link tool to agent (e.g. /link echo general)",
  "/unlink": "Unlink tool from agent",
  "/diff": "Show local vs registry diff",
};

export const SLASH_COMMAND_DEFS: SlashCommandDef[] = [
  ...Object.entries(SESSION_COMMANDS).map(([name, description]) => ({
    name,
    description,
    section: "session" as const,
  })),
  ...Object.entries(CLI_COMMANDS).map(([name, description]) => ({
    name,
    description,
    section: "cli" as const,
  })),
];

export async function runCliCommand(
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn([process.execPath, process.argv[1], ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  const output = (stdout + stderr).trim();
  return { exitCode, output };
}

export async function handleSlashCommand(
  command: string,
  ctx: {
    cwd: string;
    conversationId: string;
    compactNow: () => Promise<void>;
    clearMessages: () => void;
  },
): Promise<SlashCommandResult> {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "/help": {
      const sessionDefs = SLASH_COMMAND_DEFS.filter((d) => d.section === "session");
      const cliDefs = SLASH_COMMAND_DEFS.filter((d) => d.section === "cli");
      const sessionLines = sessionDefs.map(
        (d) => `  ${pc.cyan(d.name.padEnd(12))} ${d.description}`,
      );
      const cliLines = cliDefs.map(
        (d) => `  ${pc.cyan(d.name.padEnd(12))} ${d.description}`,
      );
      const content = [
        `${pc.bold("Session commands:")}`,
        ...sessionLines,
        "",
        `${pc.bold("CLI commands:")}`,
        ...cliLines,
      ].join("\n");
      return { type: "message", content };
    }

    case "/resume":
      return { type: "interactive", command: "resume" };

    case "/compact": {
      await ctx.compactNow();
      return { type: "message", content: "" };
    }

    case "/export": {
      try {
        const exportPath = await exportConversation(ctx.cwd, ctx.conversationId);
        return { type: "message", content: `Exported to ${exportPath}` };
      } catch (err: any) {
        return { type: "message", content: `Export failed: ${err.message}` };
      }
    }

    case "/history": {
      const convos = await listConversations(ctx.cwd);
      if (convos.length === 0) {
        return { type: "message", content: "No conversation history." };
      }
      const lines = convos.slice(0, 10).map((c) => {
        const date = new Date(c.updatedAt).toLocaleDateString();
        const msgs = `${c.messageCount} msg${c.messageCount !== 1 ? "s" : ""}`;
        return `  ${pc.dim(c.id)} ${c.title} ${pc.dim(`(${date}, ${msgs})`)}`;
      });
      return { type: "message", content: `Recent conversations:\n${lines.join("\n")}` };
    }

    case "/clear": {
      ctx.clearMessages();
      return { type: "message", content: "Conversation cleared." };
    }

    case "/exit":
    case "/quit":
    case "/q":
      return { type: "exit" };

    // CLI commands — return args for subprocess execution
    case "/init":
      return { type: "cli", args: ["init", "--yes", ...args], mutating: true };

    case "/add": {
      if (args.length === 0) {
        return { type: "message", content: `Usage: ${pc.cyan("/add <component...>")} — e.g. /add weather-agent` };
      }
      return { type: "cli", args: ["add", ...args, "--yes", "--overwrite"], mutating: true };
    }

    case "/remove": {
      if (args.length === 0) {
        return { type: "message", content: `Usage: ${pc.cyan("/remove <component>")} — e.g. /remove weather-agent` };
      }
      return { type: "cli", args: ["remove", ...args], mutating: true };
    }

    case "/list":
      return { type: "cli", args: ["list", ...args], mutating: false };

    case "/info": {
      if (args.length === 0) {
        return { type: "message", content: `Usage: ${pc.cyan("/info <component>")} — e.g. /info weather-agent` };
      }
      return { type: "cli", args: ["info", ...args], mutating: false };
    }

    case "/update":
      return { type: "cli", args: ["update", ...args], mutating: true };

    case "/link": {
      if (args.length < 2) {
        return { type: "message", content: `Usage: ${pc.cyan("/link <tool> <agent>")} — e.g. /link echo general` };
      }
      return { type: "cli", args: ["link", "tool", args[0], "--to", args[1]], mutating: true };
    }

    case "/unlink": {
      if (args.length < 2) {
        return { type: "message", content: `Usage: ${pc.cyan("/unlink <tool> <agent>")} — e.g. /unlink echo general` };
      }
      return { type: "cli", args: ["unlink", "tool", args[0], "--from", args[1]], mutating: true };
    }

    case "/diff": {
      if (args.length === 0) {
        return { type: "message", content: `Usage: ${pc.cyan("/diff <component>")} — e.g. /diff weather-agent` };
      }
      return { type: "cli", args: ["diff", ...args], mutating: false };
    }

    default:
      return { type: "noop" };
  }
}
