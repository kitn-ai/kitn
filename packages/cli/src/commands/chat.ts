// Re-export everything from chat-engine for backward compatibility (tests import from this file)
export {
  buildServicePayload,
  hasToolCalls,
  formatTokens,
  formatElapsed,
  formatSessionStats,
  fetchGlobalRegistries,
  resolveServiceUrl,
  formatPlan,
  formatStepLabel,
  validatePlan,
  executeStep,
  handleWriteFile,
  handleReadFile,
  handleListFiles,
  handleUpdateEnvDirect,
  handleNonInteractiveTool,
  gatherProjectContext,
  callChatService,
  looksLikePlan,
  looksLikeToolCall,
  estimateChatMessageTokens,
  checkCompaction,
  callCompactService,
} from "./chat-engine.js";

export type {
  GlobalDirectoryEntry,
  GlobalRegistryEntry,
  ToolCallContext,
  ProjectContext,
} from "./chat-engine.js";

import pc from "picocolors";
import { gatherProjectContext, resolveServiceUrl } from "./chat-engine.js";
import {
  createConversation,
  listConversations,
  readConversationEvents,
  rebuildMessages,
  clearAllConversations,
} from "./chat/storage.js";

export interface CodeCommandOpts {
  url?: string;
  model?: string;
  resume?: string;
  list?: boolean;
  clear?: boolean;
}

export async function codeCommand(message: string | undefined, opts?: CodeCommandOpts): Promise<void> {
  const cwd = process.cwd();

  // Non-interactive: --list
  if (opts?.list) {
    const convos = await listConversations(cwd);
    if (convos.length === 0) {
      console.log("No conversations found.");
      return;
    }
    console.log(pc.bold("Conversations:\n"));
    for (const c of convos) {
      const date = new Date(c.updatedAt).toLocaleDateString();
      const msgs = `${c.messageCount} msg${c.messageCount !== 1 ? "s" : ""}`;
      console.log(`  ${pc.dim(c.id)}  ${c.title}  ${pc.dim(`(${date}, ${msgs})`)}`);
    }
    return;
  }

  // Non-interactive: --clear
  if (opts?.clear) {
    await clearAllConversations(cwd);
    console.log("All conversations cleared.");
    return;
  }

  const context = await gatherProjectContext(cwd);

  const metadata = context?.metadata ?? { registryIndex: [], installed: [] };
  const availableComponents = context?.availableComponents ?? [];
  const installedComponents = context?.installedComponents ?? [];
  const serviceUrl = await resolveServiceUrl(opts?.url, context?.chatServiceConfig);

  // Determine conversation context
  let conversationId: string;
  let existingMessages: import("./chat-types.js").ChatMessage[] | undefined;

  if (opts?.resume) {
    // Resume an existing conversation
    const events = await readConversationEvents(cwd, opts.resume);
    if (events.length === 0) {
      console.error(`Conversation ${opts.resume} not found.`);
      process.exit(1);
    }
    conversationId = opts.resume;
    existingMessages = rebuildMessages(events);
  } else {
    // Create a new conversation
    const title = message?.slice(0, 80) || "New conversation";
    const conv = await createConversation(cwd, title);
    conversationId = conv.id;
  }

  const { render } = await import("ink");
  const { createElement } = await import("react");
  const { ChatApp } = await import("./chat/app.js");

  const { waitUntilExit } = render(createElement(ChatApp, {
    initialMessage: message,
    serviceUrl,
    model: opts?.model,
    cwd,
    metadata,
    availableComponents,
    installedComponents,
    conversationId,
    existingMessages,
  }));
  await waitUntilExit();
}

// Backward-compatible alias
export const chatCommand = codeCommand;
