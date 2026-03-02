import { useState, useCallback, useRef } from "react";
import type { ChatMessage, ToolCall, ToolResult, UpdateEnvInput } from "../../chat-types.js";
import type { DisplayMessage } from "../components/message.js";
import {
  callChatService,
  callCompactService,
  checkCompaction,
  handleNonInteractiveTool,
  handleUpdateEnvDirect,
  hasToolCalls,
  looksLikePlan,
  looksLikeToolCall,
  type ToolCallContext,
} from "../../chat-engine.js";
import { appendMessage, appendCompaction } from "../storage.js";

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
  conversationId: string;
  existingMessages?: ChatMessage[];
}

let nextId = 0;
function makeId() {
  return `msg-${nextId++}`;
}

export function useChat(options: UseChatOptions) {
  const {
    serviceUrl, model, metadata, cwd, availableComponents, installedComponents,
    initialMessage, conversationId, existingMessages,
  } = options;

  const [state, setState] = useState<ChatState>(initialMessage ? "loading" : "idle");
  const [displayMessages, setDisplayMessages] = useState<DisplayMessage[]>([]);
  const [pendingToolCall, setPendingToolCall] = useState<PendingToolCall | null>(null);
  const [totalTokens, setTotalTokens] = useState(0);

  const messagesRef = useRef<ChatMessage[]>(existingMessages ? [...existingMessages] : []);
  const sessionStartRef = useRef(Date.now());
  const retriedRef = useRef(false);

  const toolCallCtx: ToolCallContext = { cwd, availableComponents, installedComponents };

  const addDisplayMessage = useCallback((role: DisplayMessage["role"], content: string) => {
    setDisplayMessages((prev) => [...prev, { id: makeId(), role, content }]);
  }, []);

  const persistMessage = useCallback(async (msg: ChatMessage) => {
    try {
      await appendMessage(cwd, conversationId, msg);
    } catch {
      // Silent — don't break the chat if storage fails
    }
  }, [cwd, conversationId]);

  const runCompaction = useCallback(async (): Promise<boolean> => {
    const result = checkCompaction(messagesRef.current);
    if (!result) return false;

    addDisplayMessage("system", "Compacting conversation...");
    try {
      const { summary } = await callCompactService(serviceUrl, result.toSummarize, model);
      const summaryMsg: ChatMessage = { role: "user", content: summary };
      messagesRef.current = [summaryMsg, ...result.toPreserve];

      await appendCompaction(cwd, conversationId, summary, result.toSummarize.length, result.toPreserve);
      addDisplayMessage("system", `Compacted ${result.toSummarize.length} messages.`);
      return true;
    } catch (err: any) {
      addDisplayMessage("system", `Compaction failed: ${err.message}`);
      return false;
    }
  }, [serviceUrl, model, cwd, conversationId, addDisplayMessage]);

  const sendToService = useCallback(async () => {
    setState("loading");

    // Check if compaction is needed before calling service
    await runCompaction();

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
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: response.message.content,
        };
        messagesRef.current.push(assistantMsg);
        await persistMessage(assistantMsg);

        // Retry once if the model described a plan in prose
        if (response.message.content && looksLikePlan(response.message.content) && !retriedRef.current) {
          retriedRef.current = true;
          addDisplayMessage("system", "Requesting structured plan...");
          const retryMsg: ChatMessage = {
            role: "user",
            content: "You described a plan in text instead of calling createPlan. Please call the createPlan tool with the steps you just described.",
          };
          messagesRef.current.push(retryMsg);
          await persistMessage(retryMsg);
          await sendToService();
          return;
        }

        // Retry once if the model wrote tool call JSON as text instead of calling the tool
        if (response.message.content && looksLikeToolCall(response.message.content) && !retriedRef.current) {
          retriedRef.current = true;
          addDisplayMessage("system", "Requesting proper tool call...");
          const retryMsg: ChatMessage = {
            role: "user",
            content: "You wrote a tool call as JSON text instead of actually calling the tool. Please use the tool directly — call askUser, createPlan, updateEnv, or writeFile as appropriate using the tool calling API, not as text.",
          };
          messagesRef.current.push(retryMsg);
          await persistMessage(retryMsg);
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

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: response.message.content,
        toolCalls: response.message.toolCalls,
      };
      messagesRef.current.push(assistantMsg);
      await persistMessage(assistantMsg);

      await processToolCalls(response.message.toolCalls!, []);
    } catch (err: any) {
      addDisplayMessage("system", `Error: ${err.message ?? "Could not reach service"}`);
      setState("idle");
    }
  }, [serviceUrl, metadata, model, runCompaction, persistMessage]);

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
    const toolMsg: ChatMessage = { role: "tool", toolResults: results };
    messagesRef.current.push(toolMsg);
    await persistMessage(toolMsg);
    await sendToService();
  }, [toolCallCtx, addDisplayMessage, sendToService, persistMessage]);

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
      const toolMsg: ChatMessage = { role: "tool", toolResults: results };
      messagesRef.current.push(toolMsg);
      await persistMessage(toolMsg);
      await sendToService();
    }
  }, [pendingToolCall, cwd, addDisplayMessage, processToolCalls, sendToService, persistMessage]);

  const sendMessage = useCallback(async (text: string) => {
    retriedRef.current = false;
    addDisplayMessage("user", text);
    const userMsg: ChatMessage = { role: "user", content: text };
    messagesRef.current.push(userMsg);
    await persistMessage(userMsg);
    await sendToService();
  }, [addDisplayMessage, sendToService, persistMessage]);

  const compactNow = useCallback(async () => {
    // Force compaction regardless of threshold
    const { toSummarize, toPreserve } = checkCompaction(messagesRef.current) ?? {
      toSummarize: messagesRef.current.slice(0, -2),
      toPreserve: messagesRef.current.slice(-2),
    };

    if (toSummarize.length === 0) {
      addDisplayMessage("system", "Not enough messages to compact.");
      return;
    }

    addDisplayMessage("system", "Compacting conversation...");
    try {
      const { summary } = await callCompactService(serviceUrl, toSummarize, model);
      const summaryMsg: ChatMessage = { role: "user", content: summary };
      messagesRef.current = [summaryMsg, ...toPreserve];

      await appendCompaction(cwd, conversationId, summary, toSummarize.length, toPreserve);
      addDisplayMessage("system", `Compacted ${toSummarize.length} messages.`);
    } catch (err: any) {
      addDisplayMessage("system", `Compaction failed: ${err.message}`);
    }
  }, [serviceUrl, model, cwd, conversationId, addDisplayMessage]);

  const clearMessages = useCallback(() => {
    messagesRef.current = [];
    setDisplayMessages([]);
  }, []);

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
    compactNow,
    clearMessages,
    messagesRef,
  };
}
