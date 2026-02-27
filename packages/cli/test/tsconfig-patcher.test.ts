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

  test("sets target to ES2022 when missing", () => {
    const input = JSON.stringify({ compilerOptions: { strict: true } }, null, 2);
    const result = patchTsconfig(input, { "@kitn/*": ["./src/ai/*"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.target).toBe("ES2022");
  });

  test("upgrades low target to ES2022", () => {
    const input = JSON.stringify({ compilerOptions: { target: "es6" } }, null, 2);
    const result = patchTsconfig(input, { "@kitn/*": ["./src/ai/*"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.target).toBe("ES2022");
  });

  test("preserves target ES2023 or higher", () => {
    const input = JSON.stringify({ compilerOptions: { target: "ES2023" } }, null, 2);
    const result = patchTsconfig(input, { "@kitn/*": ["./src/ai/*"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.target).toBe("ES2023");
  });

  test("preserves target ESNext", () => {
    const input = JSON.stringify({ compilerOptions: { target: "ESNext" } }, null, 2);
    const result = patchTsconfig(input, { "@kitn/*": ["./src/ai/*"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.target).toBe("ESNext");
  });

  test("adds skipLibCheck when missing", () => {
    const input = JSON.stringify({ compilerOptions: {} }, null, 2);
    const result = patchTsconfig(input, { "@kitn/*": ["./src/ai/*"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.skipLibCheck).toBe(true);
  });

  test("does not override explicit skipLibCheck: false", () => {
    const input = JSON.stringify({ compilerOptions: { skipLibCheck: false } }, null, 2);
    const result = patchTsconfig(input, { "@kitn/*": ["./src/ai/*"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.skipLibCheck).toBe(false);
  });

  test("adds moduleResolution and module when missing", () => {
    const input = JSON.stringify({ compilerOptions: {} }, null, 2);
    const result = patchTsconfig(input, { "@kitn/*": ["./src/ai/*"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.moduleResolution).toBe("bundler");
    expect(parsed.compilerOptions.module).toBe("ESNext");
  });

  test("preserves existing moduleResolution", () => {
    const input = JSON.stringify({ compilerOptions: { moduleResolution: "nodenext" } }, null, 2);
    const result = patchTsconfig(input, { "@kitn/*": ["./src/ai/*"] });
    const parsed = JSON.parse(result);
    expect(parsed.compilerOptions.moduleResolution).toBe("nodenext");
  });
});
