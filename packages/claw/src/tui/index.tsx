import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useState, useEffect, useCallback } from "react";
import { TerminalChannel } from "./terminal-channel.js";
import { Header } from "./components/Header.js";
import { Messages, type DisplayMessage } from "./components/Messages.js";
import { InputBar } from "./components/Input.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { useKeyboard } from "@opentui/react";
import type { ChannelManager } from "../channels/manager.js";
import type { ClawConfig } from "../config/schema.js";
import type { PluginContext } from "@kitnai/core";

const SESSION_ID = `terminal-${Date.now()}`;

interface PendingPermission {
  toolName: string;
  input: unknown;
  resolve: (decision: "allow" | "deny" | "trust" | "grant-dir") => void;
}

/**
 * Start the terminal TUI and return the terminal channel.
 */
export async function startTUI(
  config: ClawConfig,
  channelManager: ChannelManager,
  ctx?: PluginContext,
): Promise<TerminalChannel> {
  const terminalChannel = new TerminalChannel();
  channelManager.register(terminalChannel);

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });
  const root = createRoot(renderer);

  // Mutable ref for pushing messages from outside React
  let pushMessage: ((msg: DisplayMessage) => void) | null = null;
  let showPermission: ((req: PendingPermission) => void) | null = null;

  // Handle outbound messages from the agent
  terminalChannel.onMessage((_sessionId, message) => {
    pushMessage?.({
      role: "assistant",
      content: message.text,
      toolCalls: message.toolCalls,
    });
  });

  // Handle permission requests
  terminalChannel.onPermissionPrompt((request) => {
    showPermission?.({
      toolName: request.toolName,
      input: request.input,
      resolve: request.resolve,
    });
  });

  const handleMessage = async (text: string) => {
    await channelManager.handleMessage({
      sessionId: SESSION_ID,
      text,
      channelType: "terminal",
    });
  };

  // Build tool list for /tools command
  const toolDescriptions = ctx
    ? ctx.tools.list().map((t) => `- **${t.name}** — ${t.description}`)
    : [];

  const handleExit = () => {
    root.unmount();
    renderer.stop();
    process.exit(0);
  };

  root.render(
    <TUIApp
      model={config.model}
      toolDescriptions={toolDescriptions}
      onMessage={handleMessage}
      onExit={handleExit}
      registerPushMessage={(fn) => { pushMessage = fn; }}
      registerShowPermission={(fn) => { showPermission = fn; }}
    />,
  );

  return terminalChannel;
}

function TUIApp({
  model,
  toolDescriptions,
  onMessage,
  onExit,
  registerPushMessage,
  registerShowPermission,
}: {
  model: string;
  toolDescriptions: string[];
  onMessage: (text: string) => Promise<void>;
  onExit: () => void;
  registerPushMessage: (fn: (msg: DisplayMessage) => void) => void;
  registerShowPermission: (fn: (req: PendingPermission) => void) => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

  useEffect(() => {
    registerPushMessage((msg: DisplayMessage) => {
      setMessages((prev) => [...prev, msg]);
    });
    registerShowPermission((req: PendingPermission) => {
      setPendingPermission(req);
    });
  }, [registerPushMessage, registerShowPermission]);

  useKeyboard((event) => {
    if (event.ctrl && event.name === "q") {
      onExit();
    }
  });

  const helpText =
    "**Commands:**\n" +
    "- `/clear` — Clear messages\n" +
    "- `/tools` — List available tools\n" +
    "- `/exit` — Exit KitnClaw\n" +
    "- `/help` — Show this help\n" +
    "- `Ctrl+Q` — Quick exit";

  const handleSubmit = useCallback(async (text: string) => {
    if (text === "/exit" || text === "/quit") {
      onExit();
      return;
    }
    if (text === "/clear") {
      setMessages([]);
      return;
    }
    if (text === "/help") {
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: helpText },
      ]);
      return;
    }
    if (text === "/tools") {
      const content = toolDescriptions.length > 0
        ? `**Available tools (${toolDescriptions.length}):**\n${toolDescriptions.join("\n")}`
        : "No tools registered.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content },
      ]);
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsLoading(true);
    try {
      await onMessage(text);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant" as const,
          content: `**Error:** ${err.message ?? String(err)}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [onMessage, onExit, toolDescriptions, helpText]);

  const handlePermissionDecision = useCallback((decision: "allow" | "deny" | "trust" | "grant-dir") => {
    if (pendingPermission) {
      pendingPermission.resolve(decision);
      setPendingPermission(null);
    }
  }, [pendingPermission]);

  return (
    <box width="100%" height="100%" flexDirection="column">
      <Header model={model} />
      <Messages messages={messages} isLoading={isLoading} />
      {pendingPermission && (
        <PermissionPrompt
          toolName={pendingPermission.toolName}
          input={pendingPermission.input}
          onDecision={handlePermissionDecision}
        />
      )}
      <InputBar onSubmit={handleSubmit} disabled={isLoading} />
    </box>
  );
}
