import { Elysia, sse } from "elysia";
import { generateText, streamText, stepCountIs } from "ai";
import { extractUsage, extractStreamUsage, SSE_EVENTS, withResilience } from "@kitnai/core";
import type { PluginContext } from "@kitnai/core";

export function createGenerateRoutes(ctx: PluginContext) {
  /** Resolve tools from the tool registry by name */
  function resolveTools(names: string[]): { tools: Record<string, any>; unknown: string[] } {
    const unknown: string[] = [];
    const tools: Record<string, any> = {};
    for (const name of names) {
      const reg = ctx.tools.get(name);
      if (!reg) {
        unknown.push(name);
      } else {
        tools[name] = reg.tool;
      }
    }
    return { tools, unknown };
  }

  return new Elysia({ prefix: "/generate" })
    .post("/", async ({ body, query, status }) => {
      const b = body as any;
      const { prompt, systemPrompt, model, tools: toolNames, maxSteps } = b;
      const format = (query.format ?? "json") as "json" | "sse";

      let tools: Record<string, any> | undefined;
      if (toolNames?.length) {
        const resolved = resolveTools(toolNames);
        if (resolved.unknown.length > 0) {
          return status(400, { error: `Unknown tool(s): ${resolved.unknown.join(", ")}` });
        }
        tools = resolved.tools;
      }

      if (format === "sse") {
        const startTime = performance.now();
        const result = streamText({
          model: ctx.model(model),
          system: systemPrompt,
          prompt,
          tools,
          stopWhen: tools ? stepCountIs(maxSteps ?? 5) : undefined,
        });

        return async function* () {
          let id = 0;
          for await (const text of result.textStream) {
            yield sse({
              id: String(id++),
              event: SSE_EVENTS.TEXT_DELTA,
              data: JSON.stringify({ text }),
            });
          }

          const usage = await result.usage;
          const usageInfo = extractStreamUsage(usage, startTime);

          yield sse({
            id: String(id++),
            event: SSE_EVENTS.DONE,
            data: JSON.stringify({
              finishReason: await result.finishReason,
              usage: usageInfo,
            }),
          });
        };
      }

      // JSON mode
      const startTime = performance.now();
      const result = await withResilience({
        fn: (overrideModel) => generateText({
          model: ctx.model(overrideModel ?? model),
          system: systemPrompt,
          prompt,
          tools,
          stopWhen: tools ? stepCountIs(maxSteps ?? 5) : undefined,
        }),
        ctx,
        modelId: model,
      });

      const toolResults = result.steps
        .flatMap((step) => step.toolResults)
        .filter(Boolean);

      return {
        text: result.text,
        model: model ?? "default",
        usage: extractUsage(result, startTime),
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        finishReason: result.finishReason,
      };
    });
}
