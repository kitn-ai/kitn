import { describe, it, expect } from "bun:test";
import { rewriteKitnImports } from "./import-rewriter.js";

const DEFAULT_ALIASES = {
  agents: "src/agents",
  tools: "src/tools",
  skills: "src/skills",
  storage: "src/storage",
};

describe("import-rewriter", () => {
  it("rewrites @kitn/tools/ import from agent to relative path", () => {
    const input = `import { weatherTool } from "@kitn/tools/weather.js";`;
    const result = rewriteKitnImports(input, "kitn:agent", "weather-agent.ts", DEFAULT_ALIASES);
    expect(result).toBe(`import { weatherTool } from "../tools/weather.js";`);
  });

  it("rewrites @kitn/storage/ import from agent to relative path", () => {
    const input = `import { store } from "@kitn/storage/memory.js";`;
    const result = rewriteKitnImports(input, "kitn:agent", "memory-agent.ts", DEFAULT_ALIASES);
    expect(result).toBe(`import { store } from "../storage/memory.js";`);
  });

  it("rewrites same-type import to ./", () => {
    const input = `import { helper } from "@kitn/agents/helper.js";`;
    const result = rewriteKitnImports(input, "kitn:agent", "main-agent.ts", DEFAULT_ALIASES);
    expect(result).toBe(`import { helper } from "./helper.js";`);
  });

  it("works with custom aliases", () => {
    const customAliases = {
      agents: "lib/ai/agents",
      tools: "lib/ai/tools",
      skills: "lib/ai/skills",
      storage: "lib/ai/storage",
    };
    const input = `import { weatherTool } from "@kitn/tools/weather.js";`;
    const result = rewriteKitnImports(input, "kitn:agent", "weather-agent.ts", customAliases);
    expect(result).toBe(`import { weatherTool } from "../tools/weather.js";`);
  });

  it("works with deeply nested custom aliases", () => {
    const customAliases = {
      agents: "src/features/agents",
      tools: "src/shared/tools",
      skills: "src/skills",
      storage: "src/storage",
    };
    const input = `import { weatherTool } from "@kitn/tools/weather.js";`;
    const result = rewriteKitnImports(input, "kitn:agent", "weather-agent.ts", customAliases);
    expect(result).toBe(`import { weatherTool } from "../../shared/tools/weather.js";`);
  });

  it("passes through content without @kitn/ imports unchanged", () => {
    const input = `import { Hono } from "hono";\nimport { z } from "zod";`;
    const result = rewriteKitnImports(input, "kitn:agent", "test.ts", DEFAULT_ALIASES);
    expect(result).toBe(input);
  });

  it("leaves non-component @kitn/ imports untouched", () => {
    const input = `import { createAIPlugin } from "@kitn/server";`;
    const result = rewriteKitnImports(input, "kitn:agent", "test.ts", DEFAULT_ALIASES);
    expect(result).toBe(input);
  });

  it("leaves @kitn/ imports with unknown types untouched", () => {
    const input = `import { foo } from "@kitn/unknown/bar.js";`;
    const result = rewriteKitnImports(input, "kitn:agent", "test.ts", DEFAULT_ALIASES);
    expect(result).toBe(input);
  });

  it("rewrites multiple imports in one file", () => {
    const input = [
      `import { searchWebTool } from "@kitn/tools/web-search.js";`,
      `import { fetchPageTool, getPageMetaTool } from "@kitn/tools/web-fetch.js";`,
    ].join("\n");
    const expected = [
      `import { searchWebTool } from "../tools/web-search.js";`,
      `import { fetchPageTool, getPageMetaTool } from "../tools/web-fetch.js";`,
    ].join("\n");
    const result = rewriteKitnImports(input, "kitn:agent", "web-search-agent.ts", DEFAULT_ALIASES);
    expect(result).toBe(expected);
  });

  it("handles export ... from syntax", () => {
    const input = `export { weatherTool } from "@kitn/tools/weather.js";`;
    const result = rewriteKitnImports(input, "kitn:agent", "index.ts", DEFAULT_ALIASES);
    expect(result).toBe(`export { weatherTool } from "../tools/weather.js";`);
  });

  it("handles single-quoted imports", () => {
    const input = `import { weatherTool } from '@kitn/tools/weather.js';`;
    const result = rewriteKitnImports(input, "kitn:agent", "weather-agent.ts", DEFAULT_ALIASES);
    expect(result).toBe(`import { weatherTool } from '../tools/weather.js';`);
  });

  it("returns content unchanged for unknown file types", () => {
    const input = `import { foo } from "@kitn/tools/bar.js";`;
    const result = rewriteKitnImports(input, "kitn:unknown", "test.ts", DEFAULT_ALIASES);
    expect(result).toBe(input);
  });

  it("rewrites tool importing from storage", () => {
    const input = `import { store } from "@kitn/storage/conversation.js";`;
    const result = rewriteKitnImports(input, "kitn:tool", "chat-tool.ts", DEFAULT_ALIASES);
    expect(result).toBe(`import { store } from "../storage/conversation.js";`);
  });
});
