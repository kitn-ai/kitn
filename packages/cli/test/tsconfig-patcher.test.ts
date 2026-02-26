import { describe, test, expect } from "bun:test";
import { patchTsconfig } from "../src/installers/tsconfig-patcher.js";

describe("tsconfig patcher", () => {
  test("adds paths to empty tsconfig", () => {
    const input = '{\n  "compilerOptions": {\n    "strict": true\n  }\n}';
    const result = patchTsconfig(input, { "@kitnai/core": ["./src/ai/core/index.ts"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
    expect(parsed.compilerOptions.strict).toBe(true);
  });

  test("merges paths into existing paths", () => {
    const input = JSON.stringify({
      compilerOptions: {
        paths: { "@/*": ["./src/*"] },
      },
    }, null, 2);
    const result = patchTsconfig(input, { "@kitnai/core": ["./src/ai/core/index.ts"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
  });

  test("overwrites existing package path", () => {
    const input = JSON.stringify({
      compilerOptions: {
        paths: { "@kitnai/core": ["./old/path/index.ts"] },
      },
    }, null, 2);
    const result = patchTsconfig(input, { "@kitnai/core": ["./src/ai/core/index.ts"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
  });

  test("creates compilerOptions if missing", () => {
    const input = "{}";
    const result = patchTsconfig(input, { "@kitnai/core": ["./src/ai/core/index.ts"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
  });

  test("handles multiple paths at once", () => {
    const input = '{ "compilerOptions": {} }';
    const result = patchTsconfig(input, {
      "@kitnai/core": ["./src/ai/core/index.ts"],
      "@kitnai/hono": ["./src/ai/routes/index.ts"],
    });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
    expect(parsed.compilerOptions.paths["@kitnai/hono"]).toEqual(["./src/ai/routes/index.ts"]);
  });

  test("handles JSONC with comments and trailing commas", () => {
    const input = `{
  // Environment setup & latest features
  "compilerOptions": {
    "strict": true,
    /* multi-line
       comment */
    "target": "ES2022",
  }
}`;
    const result = patchTsconfig(input, { "@kitnai/core": ["./src/ai/core/index.ts"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.paths["@kitnai/core"]).toEqual(["./src/ai/core/index.ts"]);
    expect(parsed.compilerOptions.strict).toBe(true);
    expect(parsed.compilerOptions.target).toBe("ES2022");
  });
});
