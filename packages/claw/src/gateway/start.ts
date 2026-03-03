import { loadConfig, ensureClawHome } from "../config/io.js";
import { createClawPlugin } from "./create-plugin.js";
import { registerBuiltinTools } from "../tools/register-builtin.js";
import { PermissionManager } from "../permissions/manager.js";
import type { PluginContext } from "@kitnai/core";
import type { ClawConfig } from "../config/schema.js";

export interface GatewayContext {
  config: ClawConfig;
  plugin: PluginContext;
  permissions: PermissionManager;
}

export async function startGateway(): Promise<GatewayContext> {
  console.log("[kitnclaw] Starting gateway...");

  // 1. Ensure home directory structure
  await ensureClawHome();

  // 2. Load config
  const config = await loadConfig();
  console.log(`[kitnclaw] Model: ${config.model}`);

  // 3. Create @kitnai/core plugin
  const plugin = createClawPlugin(config);
  console.log("[kitnclaw] Core plugin initialized");

  // 4. Register built-in tools
  registerBuiltinTools(plugin);
  console.log(`[kitnclaw] ${plugin.tools.list().length} tools registered`);

  // 5. Initialize permission manager
  const permissions = new PermissionManager(config.permissions);

  // 6. Load workspace components (Phase 6)
  // TODO: loadWorkspaceComponents(plugin);

  // 7. Start channels (Phase 5)
  // TODO: startChannels(config, plugin);

  // 8. Start TUI (Phase 4)
  // TODO: startTUI(config, plugin);

  console.log("[kitnclaw] Gateway running. Press Ctrl+C to stop.");

  const ctx: GatewayContext = { config, plugin, permissions };

  // Keep process alive until interrupted
  process.on("SIGINT", () => {
    console.log("\n[kitnclaw] Shutting down...");
    process.exit(0);
  });

  return ctx;
}
