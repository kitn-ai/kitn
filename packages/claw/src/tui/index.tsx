import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useState, useEffect, useCallback } from "react";
import { TerminalChannel } from "./terminal-channel.js";
import { Header } from "./components/Header.js";
import { Messages, type DisplayMessage } from "./components/Messages.js";
import { InputBar } from "./components/Input.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { StatusBar } from "./components/StatusBar.js";
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

// Escape sequences to disable mouse tracking modes
const DISABLE_MOUSE =
  "\x1b[?1000l" + // normal tracking
  "\x1b[?1002l" + // button-event tracking
  "\x1b[?1003l" + // any-event tracking
  "\x1b[?1006l" + // SGR extended mode
  "\x1b[?25h";    // show cursor

interface SlashCommand {
  name: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/help",  description: "Show available commands" },
  { name: "/tools", description: "List available tools" },
  { name: "/model", description: "Switch the AI model" },
  { name: "/clear", description: "Clear chat history" },
  { name: "/exit",  description: "Exit KitnClaw" },
];

const POPULAR_MODELS = [
  // OpenRouter format
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/o1-mini",
  "anthropic/claude-opus-4",
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-haiku-4-5",
  "google/gemini-2.0-flash",
  "google/gemini-2.5-pro",
  "meta-llama/llama-3.3-70b-instruct",
  // Native API format
  "gpt-4o",
  "gpt-4o-mini",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
];

/**
 * Start the terminal TUI and return the terminal channel + cleanup function.
 */
export async function startTUI(
  config: ClawConfig,
  channelManager: ChannelManager,
  ctx?: PluginContext,
  onModelChange?: (model: string) => void,
): Promise<{ channel: TerminalChannel; cleanup: () => void }> {
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

  const cleanup = () => {
    root.unmount();
    renderer.destroy(); // restores terminal state and disables mouse tracking
  };

  // Safety net for crashes/unhandled signals — renderer.destroy() may not run
  process.on("exit", () => {
    try { process.stdout.write(DISABLE_MOUSE); } catch {}
  });

  const handleExit = () => {
    cleanup();
    process.exit(0);
  };

  root.render(
    <TUIApp
      model={config.model}
      toolDescriptions={toolDescriptions}
      onMessage={handleMessage}
      onExit={handleExit}
      onModelChange={onModelChange}
      registerPushMessage={(fn) => { pushMessage = fn; }}
      registerShowPermission={(fn) => { showPermission = fn; }}
    />,
  );

  return { channel: terminalChannel, cleanup };
}

function TUIApp({
  model,
  toolDescriptions,
  onMessage,
  onExit,
  onModelChange,
  registerPushMessage,
  registerShowPermission,
}: {
  model: string;
  toolDescriptions: string[];
  onMessage: (text: string) => Promise<void>;
  onExit: () => void;
  onModelChange?: (model: string) => void;
  registerPushMessage: (fn: (msg: DisplayMessage) => void) => void;
  registerShowPermission: (fn: (req: PendingPermission) => void) => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [currentModel, setCurrentModel] = useState(model);

  // Input state — controlled here so picker logic can read and clear it
  const [inputValue, setInputValue] = useState("");
  // Increment to force InputBar to remount textarea with current value
  const [syncCount, setSyncCount] = useState(0);

  // For externally-driven value changes (clear, history nav), sync the textarea
  const setInputAndSync = useCallback((v: string) => {
    setInputValue(v);
    setSyncCount((c) => c + 1);
  }, []);

  // History (newest first)
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Picker state
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);

  // Determine which picker (if any) is active
  const inputBlocked = isLoading || !!pendingPermission;
  const commandQuery = inputValue.startsWith("/") && !inputValue.includes(" ")
    ? inputValue.slice(1).toLowerCase()
    : null;
  const filteredCommands = commandQuery !== null && !showModelPicker && !inputBlocked
    ? SLASH_COMMANDS.filter(
        (c) =>
          c.name.slice(1).startsWith(commandQuery) ||
          c.description.toLowerCase().includes(commandQuery),
      )
    : [];
  const filteredModels = showModelPicker && !inputBlocked
    ? POPULAR_MODELS.filter((m) => m.toLowerCase().includes(inputValue.toLowerCase()))
    : [];

  const showCommandPicker = filteredCommands.length > 0;
  const pickerItems = showModelPicker ? filteredModels : filteredCommands.map((c) => c.name);
  const pickerVisible = showCommandPicker || (showModelPicker && filteredModels.length > 0);
  const safeIndex = pickerItems.length > 0 ? Math.min(pickerIndex, pickerItems.length - 1) : 0;

  // Reset picker index when items change
  useEffect(() => {
    setPickerIndex(0);
  }, [inputValue, showModelPicker]);

  useEffect(() => {
    registerPushMessage((msg: DisplayMessage) => {
      setMessages((prev) => [...prev, msg]);
    });
    registerShowPermission((req: PendingPermission) => {
      setPendingPermission(req);
    });
  }, [registerPushMessage, registerShowPermission]);

  useKeyboard((event) => {
    // Global exit
    if (event.ctrl && (event.name === "c" || event.name === "q")) {
      onExit();
      return;
    }

    if (inputBlocked) return;

    // Picker open: handle ALL keyboard interaction here
    // (input is unfocused when picker is visible, so onChange won't fire)
    if (pickerVisible) {
      if (event.name === "up") {
        setPickerIndex((i) => Math.max(0, i - 1));
      } else if (event.name === "down") {
        setPickerIndex((i) => Math.min(pickerItems.length - 1, i + 1));
      } else if (event.name === "escape") {
        setShowModelPicker(false);
        setInputAndSync("");
      } else if (event.name === "enter" || event.name === "return") {
        handleSubmit(inputValue);
      } else if (event.name === "backspace") {
        setInputValue((v) => v.slice(0, -1));
      } else if (!event.ctrl && !event.meta && event.name && event.name.length === 1) {
        // Typing filters the picker list
        setInputValue((v) => v + event.name);
      }
      return;
    }

    // Not in picker mode:

    // "/" on empty input opens command picker immediately
    if (event.name === "/" && inputValue === "") {
      setInputValue("/");
      return;
    }

    // Up/Down navigate history when input is empty
    if (event.name === "up" && inputValue === "") {
      const newIdx = Math.min(historyIndex + 1, history.length - 1);
      if (newIdx >= 0 && history[newIdx]) {
        setHistoryIndex(newIdx);
        setInputAndSync(history[newIdx]);
      }
      return;
    }
    if (event.name === "down" && historyIndex >= 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      setInputAndSync(newIdx >= 0 ? (history[newIdx] ?? "") : "");
      return;
    }
  });

  const helpText =
    "**Commands:**\n" +
    "- `/help` — Show this help\n" +
    "- `/tools` — List available tools\n" +
    "- `/model` — Switch the AI model\n" +
    "- `/clear` — Clear chat history\n" +
    "- `/exit` — Exit KitnClaw\n" +
    "- `Ctrl+Q` — Quick exit\n\n" +
    "_Tip: type `/` to browse commands with arrow keys_";

  const handleModelSwitch = useCallback((newModel: string) => {
    setCurrentModel(newModel);
    onModelChange?.(newModel);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant" as const,
        content: `✓ Model switched to \`${newModel}\`. Takes effect for your next message.`,
      },
    ]);
  }, [onModelChange]);

  const handleSubmit = useCallback(async (text: string) => {
    // Model picker: selecting a model
    if (showModelPicker) {
      if (filteredModels.length > 0) {
        handleModelSwitch(filteredModels[safeIndex]);
      }
      setShowModelPicker(false);
      setInputAndSync("");
      return;
    }

    // Command picker: selecting a command
    if (showCommandPicker && filteredCommands.length > 0) {
      const cmd = filteredCommands[safeIndex];
      setInputAndSync("");
      if (cmd.name === "/model") {
        setShowModelPicker(true);
        return;
      }
      // Fall through with the command name as text
      text = cmd.name;
    }

    // Slash commands (typed directly or selected from picker)
    if (text === "/exit" || text === "/quit") {
      onExit();
      return;
    }
    if (text === "/clear") {
      setMessages([]);
      setInputAndSync("");
      return;
    }
    if (text === "/help") {
      setInputAndSync("");
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: helpText },
      ]);
      return;
    }
    if (text === "/tools") {
      setInputAndSync("");
      const content = toolDescriptions.length > 0
        ? `**Available tools (${toolDescriptions.length}):**\n${toolDescriptions.join("\n")}`
        : "No tools registered.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content },
      ]);
      return;
    }
    // /model <id> — direct model switch
    if (text.startsWith("/model ")) {
      const newModel = text.slice("/model ".length).trim();
      if (newModel) handleModelSwitch(newModel);
      setInputAndSync("");
      return;
    }
    if (text === "/model") {
      setInputAndSync("");
      setShowModelPicker(true);
      return;
    }

    // Normal message to agent
    setHistory((prev) => [text, ...prev.filter((h) => h !== text).slice(0, 99)]);
    setHistoryIndex(-1);
    setInputAndSync("");
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
  }, [
    onMessage, onExit, toolDescriptions, helpText, handleModelSwitch,
    showModelPicker, showCommandPicker, filteredCommands, filteredModels, safeIndex,
    setInputAndSync,
  ]);

  const handlePermissionDecision = useCallback((decision: "allow" | "deny" | "trust" | "grant-dir") => {
    if (pendingPermission) {
      pendingPermission.resolve(decision);
      setPendingPermission(null);
    }
  }, [pendingPermission]);

  // Build picker lines — single <text> with \n avoids OpenTUI y=0 overlap bug
  const pickerLines: string[] = showModelPicker
    ? filteredModels.map((m, i) => `${i === safeIndex ? "▶" : " "} ${m}`)
    : filteredCommands.map(
        (c, i) =>
          `${i === safeIndex ? "▶" : " "} ${c.name.padEnd(10)} ${c.description}`,
      );

  const inputPlaceholder = showModelPicker
    ? "Filter models…  ↑↓ navigate  ↵ select  Esc cancel"
    : "Message KitnClaw…   / for commands   Shift+↵ newline";

  return (
    <box width="100%" height="100%" flexDirection="column">
      <Header model={currentModel} />
      <Messages messages={messages} isLoading={isLoading} />
      {pendingPermission && (
        <PermissionPrompt
          toolName={pendingPermission.toolName}
          input={pendingPermission.input}
          onDecision={handlePermissionDecision}
        />
      )}
      {pickerVisible && (
        <box
          width="100%"
          height={pickerItems.length + 2}
          borderStyle="single"
          borderColor="#5599FF"
          paddingLeft={1}
          paddingRight={1}
        >
          <text>{pickerLines.join("\n")}</text>
        </box>
      )}
      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={(text) => handleSubmit(text)}
        disabled={inputBlocked}
        focused={!pickerVisible}
        placeholder={inputPlaceholder}
        syncCount={syncCount}
      />
      <StatusBar isLoading={isLoading} />
    </box>
  );
}
