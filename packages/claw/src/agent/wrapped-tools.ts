import { tool } from "ai";
import type { PluginContext } from "@kitnai/core";
import { PermissionManager } from "../permissions/manager.js";
import type { BudgetLedger } from "../governance/budget.js";
import type { DraftQueue } from "../governance/drafts.js";
import { describeAction } from "../permissions/describe.js";

export interface PermissionHandler {
  onConfirm(toolName: string, input: unknown): Promise<"allow" | "deny" | "trust" | "grant-dir">;
}

export interface WrapToolsOptions {
  channelType?: string;
  budgetLedger?: BudgetLedger;
  draftQueue?: DraftQueue;
  sessionId?: string;
}

/**
 * Wrap all registered tools with permission checks and optional budget enforcement.
 * Returns a Record<string, tool> suitable for passing to generateText().
 *
 * When a `budgetLedger` is provided and a tool's input includes `_spending`
 * metadata (`{ domain: string, amount: number }`), the budget is checked
 * before execution. The AI cannot override spending limits because this
 * check happens inside the tool's execute function.
 */
export function wrapToolsWithPermissions(
  ctx: PluginContext,
  permissions: PermissionManager,
  handler: PermissionHandler,
  channelTypeOrOptions?: string | WrapToolsOptions,
): Record<string, any> {
  const opts: WrapToolsOptions =
    typeof channelTypeOrOptions === "string"
      ? { channelType: channelTypeOrOptions }
      : channelTypeOrOptions ?? {};

  const { channelType, budgetLedger, draftQueue, sessionId } = opts;
  const wrapped: Record<string, any> = {};

  for (const reg of ctx.tools.list()) {
    wrapped[reg.name] = tool({
      description: reg.description,
      inputSchema: reg.inputSchema,
      execute: async (input: any) => {
        const decision = permissions.evaluate(reg.name, input ?? {}, channelType);

        if (decision === "deny") {
          return { error: `Tool "${reg.name}" is denied by configuration.` };
        }

        if (decision === "draft" && draftQueue) {
          const preview = describeAction(reg.name, input ?? {});
          await draftQueue.create({
            action: preview.summary,
            toolName: reg.name,
            input: input ?? {},
            preview: `${preview.icon} ${preview.summary}${preview.detail ? ` — ${preview.detail}` : ""}`,
            sessionId: sessionId ?? "unknown",
          });
          return {
            draft: true,
            message: `This action has been saved as a draft for your review: ${preview.summary}`,
          };
        }

        if (decision === "confirm") {
          const response = await handler.onConfirm(reg.name, input);
          if (response === "deny") {
            return { error: `User denied execution of "${reg.name}".` };
          }
          if (response === "trust") {
            permissions.trustForSession(reg.name);
          }
          if (response === "grant-dir") {
            // Grant access to the directory containing the target path
            const path = typeof input?.path === "string" ? input.path : null;
            if (path) {
              const dir = path.substring(0, path.lastIndexOf("/") + 1);
              if (dir) permissions.grantDirectory(dir);
            }
          }
        }

        // Budget enforcement — check before executing
        if (budgetLedger && input?._spending) {
          const { domain, amount } = input._spending;
          if (typeof domain === "string" && typeof amount === "number") {
            const result = await budgetLedger.trySpend(domain, amount);
            if (!result.allowed) {
              return {
                error: `Budget exceeded for ${domain}. Remaining: $${result.remaining} of $${result.limit} limit.`,
              };
            }
          }
        }

        // Execute the original tool
        return ctx.tools.execute(reg.name, input);
      },
    });
  }

  return wrapped;
}
