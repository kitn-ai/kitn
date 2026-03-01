import { registerTool } from "@kitn/core";
import { tool } from "ai";
import { z } from "zod";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/** Capability keywords mapped to supported_parameters values or modality checks */
const CAPABILITY_MAP: Record<string, (m: OpenRouterModel) => boolean> = {
  tools: (m) => m.supported_parameters.includes("tools"),
  reasoning: (m) =>
    m.supported_parameters.includes("reasoning") ||
    m.supported_parameters.includes("include_reasoning"),
  vision: (m) => m.architecture.input_modalities.includes("image"),
  audio: (m) =>
    m.architecture.input_modalities.includes("audio") ||
    m.architecture.output_modalities.includes("audio"),
  video: (m) => m.architecture.input_modalities.includes("video"),
  "image-output": (m) => m.architecture.output_modalities.includes("image"),
  "structured-output": (m) =>
    m.supported_parameters.includes("structured_outputs") ||
    m.supported_parameters.includes("response_format"),
  "web-search": (m) => m.supported_parameters.includes("web_search"),
  streaming: (m) => true, // all OpenRouter models support streaming
  caching: (m) =>
    m.pricing.input_cache_read !== undefined &&
    m.pricing.input_cache_read !== "0",
};

interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
  };
  pricing: {
    prompt: string;
    completion: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number | null;
    is_moderated: boolean;
  };
  supported_parameters: string[];
}

interface CompactModel {
  id: string;
  name: string;
  contextLength: number;
  maxOutputTokens: number | null;
  modality: string;
  inputModalities: string[];
  outputModalities: string[];
  promptPrice: string;
  completionPrice: string;
  hasCaching: boolean;
  capabilities: string[];
}

function toCompact(m: OpenRouterModel): CompactModel {
  const capabilities: string[] = [];
  for (const [cap, check] of Object.entries(CAPABILITY_MAP)) {
    if (check(m)) capabilities.push(cap);
  }

  return {
    id: m.id,
    name: m.name,
    contextLength: m.context_length,
    maxOutputTokens: m.top_provider.max_completion_tokens,
    modality: m.architecture.modality,
    inputModalities: m.architecture.input_modalities,
    outputModalities: m.architecture.output_modalities,
    promptPrice: m.pricing.prompt,
    completionPrice: m.pricing.completion,
    hasCaching:
      m.pricing.input_cache_read !== undefined &&
      m.pricing.input_cache_read !== "0",
    capabilities,
  };
}

export const modelSelectorTool = tool({
  description:
    "Search the OpenRouter model catalog to find models matching specific requirements. Filter by capabilities (tools, reasoning, vision, audio, structured output), cost, context length, and text search. Returns compact model cards with only the fields needed for selection. No API key required.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Text search — matches against model name, ID, and description. Case-insensitive."
      ),
    capabilities: z
      .array(
        z.enum([
          "tools",
          "reasoning",
          "vision",
          "audio",
          "video",
          "image-output",
          "structured-output",
          "web-search",
          "caching",
        ])
      )
      .optional()
      .describe(
        "Required capabilities — only models supporting ALL listed capabilities are returned"
      ),
    maxPromptPrice: z
      .string()
      .optional()
      .describe(
        "Maximum prompt price per token (string, e.g. '0.000003'). Models costing more are excluded."
      ),
    maxCompletionPrice: z
      .string()
      .optional()
      .describe(
        "Maximum completion price per token (string, e.g. '0.000015'). Models costing more are excluded."
      ),
    minContextLength: z
      .number()
      .optional()
      .describe("Minimum context window in tokens (e.g. 128000)"),
    sortBy: z
      .enum(["price", "context", "name"])
      .default("price")
      .describe(
        "Sort results by: price (cheapest prompt first), context (largest first), or name (alphabetical)"
      ),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of results to return (1-50, default 10)"),
  }),
  execute: async ({
    query,
    capabilities,
    maxPromptPrice,
    maxCompletionPrice,
    minContextLength,
    sortBy,
    limit,
  }) => {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(
        `OpenRouter API failed: ${res.status} ${res.statusText}`
      );
    }

    const data = await res.json();
    let models: OpenRouterModel[] = data.data ?? [];

    // Filter: text search
    if (query) {
      const q = query.toLowerCase();
      models = models.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q)
      );
    }

    // Filter: capabilities
    if (capabilities && capabilities.length > 0) {
      models = models.filter((m) =>
        capabilities.every((cap) => CAPABILITY_MAP[cap]?.(m) ?? false)
      );
    }

    // Filter: price ceilings
    if (maxPromptPrice) {
      const max = parseFloat(maxPromptPrice);
      models = models.filter((m) => parseFloat(m.pricing.prompt) <= max);
    }
    if (maxCompletionPrice) {
      const max = parseFloat(maxCompletionPrice);
      models = models.filter((m) => parseFloat(m.pricing.completion) <= max);
    }

    // Filter: minimum context length
    if (minContextLength) {
      models = models.filter((m) => m.context_length >= minContextLength);
    }

    // Sort
    const sorted = [...models].sort((a, b) => {
      switch (sortBy) {
        case "price":
          return parseFloat(a.pricing.prompt) - parseFloat(b.pricing.prompt);
        case "context":
          return b.context_length - a.context_length;
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    const results = sorted.slice(0, limit ?? 10).map(toCompact);

    return {
      totalMatches: sorted.length,
      returned: results.length,
      filters: {
        query: query ?? null,
        capabilities: capabilities ?? [],
        maxPromptPrice: maxPromptPrice ?? null,
        maxCompletionPrice: maxCompletionPrice ?? null,
        minContextLength: minContextLength ?? null,
      },
      models: results,
    };
  },
});

registerTool({
  name: "model-selector-tool",
  description:
    "Search the OpenRouter model catalog to find models by capabilities, cost, context length, and features",
  inputSchema: z.object({
    query: z.string().optional(),
    capabilities: z
      .array(
        z.enum([
          "tools",
          "reasoning",
          "vision",
          "audio",
          "video",
          "image-output",
          "structured-output",
          "web-search",
          "caching",
        ])
      )
      .optional(),
    maxPromptPrice: z.string().optional(),
    maxCompletionPrice: z.string().optional(),
    minContextLength: z.number().optional(),
    sortBy: z.enum(["price", "context", "name"]).default("price"),
    limit: z.number().min(1).max(50).default(10),
  }),
  tool: modelSelectorTool,
});
