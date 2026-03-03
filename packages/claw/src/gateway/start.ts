import { loadConfig, ensureClawHome } from "../config/io.js";
import { createClawPlugin } from "./create-plugin.js";
import type { PluginContext } from "@kitnai/core";
import type { ClawConfig } from "../config/schema.js";

export interface GatewayContext {
  config: ClawConfig;
  plugin: PluginContext;
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

  // 4. Register built-in tools (Phase 2)
  // TODO: registerBuiltinTools(plugin, config);

  // 5. Load workspace components (Phase 6)
  // TODO: loadWorkspaceComponents(plugin);

  // 6. Start channels (Phase 5)
  // TODO: startChannels(config, plugin);

  // 7. Start TUI (Phase 4)
  // TODO: startTUI(config, plugin);

  console.log("[kitnclaw] Gateway running. Press Ctrl+C to stop.");

  const ctx: GatewayContext = { config, plugin };

  // Keep process alive until interrupted
  process.on("SIGINT", () => {
    console.log("\n[kitnclaw] Shutting down...");
    process.exit(0);
  });

  return ctx;
}
