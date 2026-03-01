import { useState, useCallback, useRef } from "react";
import type { ChatMessage, ToolCall, ToolResult, UpdateEnvInput } from "../../chat-types.js";
import type { DisplayMessage } from "../components/message.js";
import {
  callChatService,
  handleNonInteractiveTool,
  handleUpdateEnvDirect,
  hasToolCalls,
  looksLikePlan,
  type ToolCallContext,
} from "../../chat-engine.js";

export type ChatState = "idle" | "loading" | "pending-tool" | "complete";

export interface PendingToolCall {
  type: "askUser" | "createPlan" | "updateEnv";
  call: ToolCall;
  // Remaining tool calls to process after this one
  remainingCalls: ToolCall[];
  // Results accumulated so far for this turn
  accumulatedResults: ToolResult[];
}

interface UseChatOptions {
  serviceUrl: string;
  model?: string;
  metadata: Record<string, unknown>;
  cwd: string;
  availableComponents: string[];
  installedComponents: string[];
  initialMessage?: string;
}

let nextId = 0;
function makeId() {
  return `msg-${nextId++}`;
}

export function useChat(options: UseChatOptions) {
  const { serviceUrl, model, metadata, cwd, availableComponents, installedComponents, initialMessage } = options;

  const [state, setState] = useState<ChatState>(initialMessage ? "loading" : "idle");
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [pendingToolCall, setPendingToolCall] = useState<PendingToolCall | null>(null);
  const [totalTokens, setTotalTokens] = useState(0);

  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionStartRef = useRef(Date.now());
  const retriedRef = useRef(false);

  const toolCallCtx: ToolCallContext = { cwd, availableComponents, installedComponents };

  const addDisplayMessage = useCallback((role: DisplayMessage["role"], content: string) => {
    setDisplayMessages((prev) => [...prev, { id: makeId(), role, content }]);
  }, []);

  const sendToService = useCallback(async () => {
    setState("loading");

    try {
      const response = await callChatService(serviceUrl, messagesRef.current, metadata, model);

      setTotalTokens((prev) => prev + response.usage.outputTokens);

      // Handle rejected
      if ((response as any).rejected) {
        addDisplayMessage("system", (response as any).text ?? "Request was rejected.");
        setState("idle");
        return;
      }

      // No tool calls — check if model described a plan in text instead of calling createPlan
      if (!hasToolCalls(response)) {
        if (response.message.content) {
          addDisplayMessage("assistant", response.message.content);
        }
        messagesRef.current.push({
          role: "assistant",
          content: response.message.content,
        });

        // Retry once if the model described a plan in prose
        if (response.message.content && looksLikePlan(response.message.content) && !retriedRef.current) {
          retriedRef.current = true;
          addDisplayMessage("system", "Requesting structured plan...");
          messagesRef.current.push({
            role: "user",
            content: "You described a plan in text instead of calling createPlan. Please call the createPlan tool with the steps you just described.",
          });
          await sendToService();
          return;
        }

        retriedRef.current = false;
        setState("idle");
        return;
      }

      // Has tool calls — process them
      if (response.message.content) {
        addDisplayMessage("assistant", response.message.content);
      }

      messagesRef.current.push({
        role: "assistant",
        content: response.message.content,
        toolCalls: response.message.toolCalls,
      });

      await processToolCalls(response.message.toolCalls!, []);
    } catch (err: any) {
      addDisplayMessage("system", `Error: ${err.message ?? "Could not reach chat service"}`);
      setState("idle");
    }
  }, [serviceUrl, metadata, model]);

  const processToolCalls = useCallback(async (calls: ToolCall[], accumulatedResults: ToolResult[]) => {
    const results = [...accumulatedResults];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];

      // Try non-interactive tools first
      const nonInteractiveResult = await handleNonInteractiveTool(call, toolCallCtx);
      if (nonInteractiveResult !== null) {
        if (call.name === "writeFile") {
          addDisplayMessage("file-op", nonInteractiveResult);
        }
        results.push({ toolCallId: call.id, toolName: call.name, result: nonInteractiveResult });
        continue;
      }

      // Interactive tools — pause and let UI handle
      if (call.name === "askUser" || call.name === "createPlan" || call.name === "updateEnv") {
        setState("pending-tool");
        setPendingToolCall({
          type: call.name as "askUser" | "createPlan" | "updateEnv",
          call,
          remainingCalls: calls.slice(i + 1),
          accumulatedResults: results,
        });
        return; // Pause — will resume via resolveToolCall
      }

      // Unknown tool
      results.push({ toolCallId: call.id, toolName: call.name, result: `Unknown tool: ${call.name}` });
    }

    // All tool calls processed — send results back to service
    messagesRef.current.push({ role: "tool", toolResults: results });
    await sendToService();
  }, [toolCallCtx, addDisplayMessage, sendToService]);

  const resolveToolCall = useCallback(async (result: string) => {
    if (!pendingToolCall) return;

    const { call, remainingCalls, accumulatedResults } = pendingToolCall;

    // For updateEnv, the result is the password value — we need to execute the env update
    let finalResult = result;
    if (call.name === "updateEnv" && result !== "User cancelled.") {
      const input = call.input as UpdateEnvInput;
      finalResult = await handleUpdateEnvDirect(input, cwd, result);
      addDisplayMessage("file-op", finalResult);
    }

    if (call.name === "createPlan") {
      addDisplayMessage("plan-result", finalResult);
    }

    const results = [...accumulatedResults, { toolCallId: call.id, toolName: call.name, result: finalResult }];
    setPendingToolCall(null);

    if (remainingCalls.length > 0) {
      await processToolCalls(remainingCalls, results);
    } else {
      messagesRef.current.push({ role: "tool", toolResults: results });
      await sendToService();
    }
  }, [pendingToolCall, cwd, addDisplayMessage, processToolCalls, sendToService]);

  const sendMessage = useCallback(async (text: string) => {
    retriedRef.current = false;
    addDisplayMessage("user", text);
    messagesRef.current.push({ role: "user", content: text });
    await sendToService();
  }, [addDisplayMessage, sendToService]);

  // Auto-send initial message
  const initialSentRef = useRef(false);
  if (initialMessage && !initialSentRef.current) {
    initialSentRef.current = true;
    // Defer to next tick so component mounts first
    setTimeout(() => sendMessage(initialMessage), 0);
  }

  return {
    state,
    displayMessages,
    pendingToolCall,
    totalTokens,
    sessionStart: sessionStartRef.current,
    sendMessage,
    resolveToolCall,
  };
}
