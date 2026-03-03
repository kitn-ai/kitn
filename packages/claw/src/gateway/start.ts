import { loadConfig, ensureClawHome, CLAW_HOME } from "../config/io.js";
import { join } from "path";
import { createClawPlugin } from "./create-plugin.js";
import { registerBuiltinTools } from "../tools/register-builtin.js";
import { PermissionManager } from "../permissions/manager.js";
import { ChannelManager } from "../channels/manager.js";
import { WorkspaceWatcher } from "./watcher.js";
import { AuditLogger } from "../audit/logger.js";
import { getGovernanceDb } from "../governance/db.js";
import { createHttpServer, type HttpServer } from "./http.js";
import type { PluginContext } from "@kitnai/core";
import type { ClawConfig } from "../config/schema.js";

export interface GatewayContext {
  config: ClawConfig;
  plugin: PluginContext;
  permissions: PermissionManager;
  channels: ChannelManager;
  watcher: WorkspaceWatcher;
  httpServer: HttpServer;
}

export async function startGateway(): Promise<GatewayContext> {
  console.log("[kitnclaw] Starting gateway...");

  // 1. Ensure home directory structure
  await ensureClawHome();

  // 2. Load config
  const config = await loadConfig();

  if (!config.provider) {
    console.error("[kitnclaw] No AI provider configured.");
    console.error("[kitnclaw] Run `kitnclaw setup` to configure your provider and API key.");
    process.exit(1);
  }

  console.log(`[kitnclaw] Provider: ${config.provider.type}, Model: ${config.model}`);

  // 3. Create @kitnai/core plugin
  const plugin = createClawPlugin(config);
  console.log("[kitnclaw] Core plugin initialized");

  // 4. Register built-in tools
  registerBuiltinTools(plugin);
  console.log(`[kitnclaw] ${plugin.tools.list().length} tools registered`);

  // 4b. Wire audit logging into lifecycle hooks
  const govDb = getGovernanceDb();
  const auditLogger = new AuditLogger(govDb);

  if (plugin.hooks) {
    plugin.hooks.on("tool:execute", (event) => {
      auditLogger.log({
        event: "tool:execute",
        toolName: event.toolName,
        input: event.input,
        duration: event.duration,
      });
    });
  }
  console.log("[kitnclaw] Audit logging enabled");

  // 5. Initialize permission manager
  const sandbox = config.permissions.sandbox || join(CLAW_HOME, "workspace");
  const permissions = new PermissionManager({
    ...config.permissions,
    sandbox,
  });

  // 6. Start workspace watcher (hot-reload)
  const watcher = new WorkspaceWatcher(plugin);
  await watcher.start();
  console.log("[kitnclaw] Workspace watcher started");

  // 7. Create channel manager
  const channels = new ChannelManager({
    ctx: plugin,
    config,
    permissions,
  });

  // 8. Start HTTP server
  const bindHost = config.gateway.bind === "lan" ? "0.0.0.0" : "127.0.0.1";
  const httpServer = createHttpServer({
    port: config.gateway.port,
    hostname: bindHost,
    onMessage: async (sessionId, text) => {
      const response = await channels.handleMessage({
        sessionId,
        text,
        channelType: "http",
      });
      return { text: response.text, toolCalls: response.toolCalls };
    },
    getStatus: () => ({
      version: "0.1.0",
      model: config.model,
      channels: Array.from(Object.keys(config.channels)),
    }),
  });
  const addr = httpServer.start();
  console.log(`[kitnclaw] HTTP server listening on ${bindHost}:${addr.port}`);

  // 9. Start terminal TUI if enabled
  if (config.channels.terminal?.enabled !== false) {
    const { startTUI } = await import("../tui/index.js");
    await startTUI(config, channels, plugin);
  }

  // 10. Start remaining channels
  await channels.startAll();

  console.log("[kitnclaw] Gateway running. Press Ctrl+C to stop.");

  const ctx: GatewayContext = { config, plugin, permissions, channels, watcher, httpServer };

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[kitnclaw] Shutting down...");
    httpServer.stop();
    watcher.stop();
    channels.stopAll().then(() => process.exit(0));
  });

  return ctx;
}
