import { tool } from "ai";
import type { PluginContext } from "@kitnai/core";
import { PermissionManager, type PermissionDecision } from "../permissions/manager.js";

export interface PermissionHandler {
  onConfirm(toolName: string, input: unknown): Promise<"allow" | "deny" | "trust">;
}

/**
 * Wrap all registered tools with permission checks.
 * Returns a Record<string, tool> suitable for passing to generateText().
 */
export function wrapToolsWithPermissions(
  ctx: PluginContext,
  permissions: PermissionManager,
  handler: PermissionHandler,
): Record<string, any> {
  const wrapped: Record<string, any> = {};

  for (const reg of ctx.tools.list()) {
    wrapped[reg.name] = tool({
      description: reg.description,
      inputSchema: reg.inputSchema,
      execute: async (input: any) => {
        const decision = permissions.check(reg.name);

        if (decision === "deny") {
          return { error: `Tool "${reg.name}" is denied by configuration.` };
        }

        if (decision === "confirm") {
          const response = await handler.onConfirm(reg.name, input);
          if (response === "deny") {
            return { error: `User denied execution of "${reg.name}".` };
          }
          if (response === "trust") {
            permissions.trustForSession(reg.name);
          }
        }

        // Execute the original tool
        return ctx.tools.execute(reg.name, input);
      },
    });
  }

  return wrapped;
}
