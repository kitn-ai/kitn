import { basename, dirname } from "path";

export interface ActionDescription {
  summary: string;
  detail?: string;
  icon: string;
  destructive: boolean;
  canGrantDir: boolean;
  grantDirLabel?: string;
}

export function describeAction(
  toolName: string,
  input: Record<string, unknown>,
): ActionDescription {
  const path = typeof input.path === "string" ? input.path : "";
  const command = typeof input.command === "string" ? input.command : "";
  const url = typeof input.url === "string" ? input.url : "";

  switch (toolName) {
    case "file-read":
      return {
        summary: `Read the file ${basename(path)}`,
        detail: path,
        icon: "📖",
        destructive: false,
        canGrantDir: false,
      };

    case "file-write": {
      const dir = dirname(path);
      const dirName = basename(dir);
      return {
        summary: `Save a file to ${dirName}`,
        detail: path,
        icon: "📄",
        destructive: false,
        canGrantDir: true,
        grantDirLabel: `Always allow saving to ${dirName}`,
      };
    }

    case "file-delete":
      return {
        summary: `Delete the file ${basename(path)}`,
        detail: path,
        icon: "🗑️",
        destructive: true,
        canGrantDir: false,
      };

    case "file-search":
      return {
        summary: "Search for files on your computer",
        detail:
          typeof input.pattern === "string"
            ? `Pattern: ${input.pattern}`
            : undefined,
        icon: "🔍",
        destructive: false,
        canGrantDir: false,
      };

    case "bash":
      return {
        summary: "Run a command on your computer",
        detail: command,
        icon: "⚡",
        destructive: false,
        canGrantDir: false,
      };

    case "web-fetch":
      return {
        summary: "Visit a website",
        detail: url ? new URL(url).hostname : undefined,
        icon: "🌐",
        destructive: false,
        canGrantDir: false,
      };

    case "web-search":
      return {
        summary: "Search the web",
        detail:
          typeof input.query === "string" ? input.query : undefined,
        icon: "🔎",
        destructive: false,
        canGrantDir: false,
      };

    case "send-message":
      return {
        summary: "Send a message on your behalf",
        detail:
          typeof input.channel === "string"
            ? `via ${input.channel}`
            : undefined,
        icon: "✉️",
        destructive: false,
        canGrantDir: false,
      };

    case "kitn-add":
      return {
        summary: "Install a new component",
        detail:
          typeof input.component === "string"
            ? input.component
            : undefined,
        icon: "📦",
        destructive: false,
        canGrantDir: false,
      };

    case "kitn-registry-search":
      return {
        summary: "Search the component registry",
        detail:
          typeof input.query === "string"
            ? `"${input.query}"${typeof input.type === "string" ? ` (${input.type}s)` : ""}`
            : undefined,
        icon: "🔍",
        destructive: false,
        canGrantDir: false,
      };

    case "memory-save":
      return {
        summary: "Save something to memory",
        detail:
          typeof input.content === "string"
            ? input.content.slice(0, 60)
            : undefined,
        icon: "🧠",
        destructive: false,
        canGrantDir: false,
      };

    case "memory-search":
      return {
        summary: "Search your memory",
        detail:
          typeof input.query === "string" ? `"${input.query}"` : undefined,
        icon: "🧠",
        destructive: false,
        canGrantDir: false,
      };

    case "create-tool":
      return {
        summary: "Create a new custom tool",
        detail:
          typeof input.name === "string" ? input.name : undefined,
        icon: "🛠️",
        destructive: false,
        canGrantDir: false,
      };

    case "create-agent":
      return {
        summary: "Create a new custom agent",
        detail:
          typeof input.name === "string" ? input.name : undefined,
        icon: "🤖",
        destructive: false,
        canGrantDir: false,
      };

    default:
      return {
        summary: `Use the tool "${toolName}"`,
        icon: "🔧",
        destructive: false,
        canGrantDir: false,
      };
  }
}
