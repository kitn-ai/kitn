import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { generateText, streamText, stepCountIs } from "ai";
import { extractUsage, extractStreamUsage, SSE_EVENTS, withResilience } from "@kitnai/core";
import type { PluginContext } from "@kitnai/core";

export function createGenerateHandlers(ctx: PluginContext) {
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

  async function handleGenerate(c: Context) {
    const body = await c.req.json();
    const { prompt, systemPrompt, model, tools: toolNames, maxSteps } = body;

    let tools: Record<string, any> | undefined;
    if (toolNames?.length) {
      const resolved = resolveTools(toolNames);
      if (resolved.unknown.length > 0) {
        return c.json({ error: `Unknown tool(s): ${resolved.unknown.join(", ")}` }, 400);
      }
      tools = resolved.tools;
    }

    const startTime = performance.now();
    const result = await withResilience({
      fn: (overrideModel) => generateText({
        model: ctx.getModel(overrideModel ?? model),
        system: systemPrompt,
        prompt,
        tools,
        stopWhen: tools ? stepCountIs(maxSteps ?? 5) : undefined,
      }),
      ctx, modelId: model,
    });

    const toolResults = result.steps
      .flatMap((step) => step.toolResults)
      .filter(Boolean);

    return c.json({
      text: result.text,
      model: model ?? "default",
      usage: extractUsage(result, startTime),
      toolResults: toolResults.length > 0 ? toolResults : undefined,
      finishReason: result.finishReason,
    }, 200);
  }

  async function handleGenerateStream(c: Context) {
    const body = await c.req.json();
    const { prompt, systemPrompt, model, tools: toolNames, maxSteps } = body;

    let tools: Record<string, any> | undefined;
    if (toolNames?.length) {
      const resolved = resolveTools(toolNames);
      if (resolved.unknown.length > 0) {
        return c.json({ error: `Unknown tool(s): ${resolved.unknown.join(", ")}` }, 400);
      }
      tools = resolved.tools;
    }

    const startTime = performance.now();
    const result = streamText({
      model: ctx.getModel(model),
      system: systemPrompt,
      prompt,
      tools,
      stopWhen: tools ? stepCountIs(maxSteps ?? 5) : undefined,
    });

    return streamSSE(c, async (stream) => {
      let id = 0;
      for await (const text of result.textStream) {
        await stream.writeSSE({
          id: String(id++),
          event: SSE_EVENTS.TEXT_DELTA,
          data: JSON.stringify({ text }),
        });
      }

      const usage = await result.usage;
      const usageInfo = extractStreamUsage(usage, startTime);

      await stream.writeSSE({
        id: String(id++),
        event: SSE_EVENTS.DONE,
        data: JSON.stringify({
          finishReason: await result.finishReason,
          usage: usageInfo,
        }),
      });
    });
  }

  return { handleGenerate, handleGenerateStream };
}
