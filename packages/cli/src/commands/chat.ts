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
} from "./chat-engine.js";

export type {
  GlobalDirectoryEntry,
  GlobalRegistryEntry,
  ToolCallContext,
  ProjectContext,
} from "./chat-engine.js";

import { gatherProjectContext, resolveServiceUrl } from "./chat-engine.js";

export async function chatCommand(message: string | undefined, opts?: { url?: string; model?: string }): Promise<void> {
  const cwd = process.cwd();
  const context = await gatherProjectContext(cwd);
  if (!context) {
    console.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  const serviceUrl = await resolveServiceUrl(opts?.url, context.chatServiceConfig);

  const { render } = await import("ink");
  const { createElement } = await import("react");
  const { ChatApp } = await import("./chat/app.js");

  const { waitUntilExit } = render(createElement(ChatApp, {
    initialMessage: message,
    serviceUrl,
    model: opts?.model,
    cwd,
    metadata: context.metadata,
    availableComponents: context.availableComponents,
    installedComponents: context.installedComponents,
  }));
  await waitUntilExit();
}
