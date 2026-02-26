import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { buildComponent } from "../src/registry/builder.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "kitn-builder-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true });
});

describe("buildComponent", () => {
  test("builds a standalone single-file component", async () => {
    await writeFile(
      join(testDir, "registry.json"),
      JSON.stringify({
        type: "kitn:tool",
        name: "weather",
        version: "1.0.0",
        description: "Get weather info",
        dependencies: ["zod"],
        files: ["weather.ts"],
      })
    );
    await writeFile(
      join(testDir, "weather.ts"),
      'export const weather = "sunny";'
    );

    const result = await buildComponent(testDir);

    expect(result.name).toBe("weather");
    expect(result.type).toBe("kitn:tool");
    expect(result.version).toBe("1.0.0");
    expect(result.description).toBe("Get weather info");
    expect(result.dependencies).toEqual(["zod"]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("tools/weather.ts");
    expect(result.files[0].content).toBe('export const weather = "sunny";');
    expect(result.files[0].type).toBe("kitn:tool");
  });

  test("builds a package component merging from package.json", async () => {
    await writeFile(
      join(testDir, "registry.json"),
      JSON.stringify({
        type: "kitn:package",
        description: "Framework-agnostic engine",
        installDir: "core",
        tsconfig: { "@kitnai/core": ["./index.ts"] },
      })
    );
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "@kitnai/core",
        version: "2.0.0",
        description: "Core package description from package.json",
        dependencies: {
          ai: "^4.0.0",
          zod: "^3.0.0",
        },
        peerDependencies: {
          openai: "^4.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
          "some-dev-tool": "^1.0.0",
        },
      })
    );

    // Create src/ directory with .ts files
    await mkdir(join(testDir, "src"));
    await writeFile(join(testDir, "src", "index.ts"), "export * from './agent.js';");
    await writeFile(join(testDir, "src", "agent.ts"), "export class Agent {}");

    const result = await buildComponent(testDir);

    expect(result.name).toBe("core");
    expect(result.type).toBe("kitn:package");
    expect(result.version).toBe("2.0.0");
    // registry.json description takes precedence
    expect(result.description).toBe("Framework-agnostic engine");
    expect(result.dependencies).toContain("ai");
    expect(result.dependencies).toContain("zod");
    expect(result.dependencies).toContain("openai");
    // No versions in dependencies
    expect(result.dependencies).not.toContain("^4.0.0");
    expect(result.devDependencies).toEqual(["some-dev-tool"]);
    expect(result.installDir).toBe("core");
    expect(result.tsconfig).toEqual({ "@kitnai/core": ["./index.ts"] });
    expect(result.files).toHaveLength(2);
    // Files should be prefixed with installDir for packages
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(["core/agent.ts", "core/index.ts"]);
    expect(result.files.every((f) => f.type === "kitn:package")).toBe(true);
  });

  test("applies exclude list for packages", async () => {
    await writeFile(
      join(testDir, "registry.json"),
      JSON.stringify({
        type: "kitn:package",
        name: "mylib",
        version: "1.0.0",
        description: "A library",
        exclude: ["internal.ts"],
      })
    );

    await mkdir(join(testDir, "src"));
    await writeFile(join(testDir, "src", "index.ts"), "export const a = 1;");
    await writeFile(join(testDir, "src", "internal.ts"), "// secret stuff");
    await writeFile(join(testDir, "src", "utils.ts"), "export const b = 2;");

    const result = await buildComponent(testDir);

    const paths = result.files.map((f) => f.path);
    expect(paths).not.toContain("package/internal.ts");
    expect(paths).toContain("package/index.ts");
    expect(paths).toContain("package/utils.ts");
    expect(result.files).toHaveLength(2);
  });

  test("throws if registry.json is missing", async () => {
    // Empty directory, no registry.json
    await expect(buildComponent(testDir)).rejects.toThrow("registry.json");
  });

  test("throws if standalone component missing required fields", async () => {
    // registry.json with only type, no package.json to provide name/description
    await writeFile(
      join(testDir, "registry.json"),
      JSON.stringify({
        type: "kitn:tool",
      })
    );

    await expect(buildComponent(testDir)).rejects.toThrow();
  });

  test("strips @scope/ prefix from package.json name", async () => {
    await writeFile(
      join(testDir, "registry.json"),
      JSON.stringify({
        type: "kitn:package",
        description: "Core engine",
      })
    );
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "@kitnai/core",
        version: "1.0.0",
      })
    );
    await mkdir(join(testDir, "src"));
    await writeFile(join(testDir, "src", "index.ts"), "export {};");

    const result = await buildComponent(testDir);

    expect(result.name).toBe("core");
  });

  test("skips workspace:* dependencies", async () => {
    await writeFile(
      join(testDir, "registry.json"),
      JSON.stringify({
        type: "kitn:package",
        description: "Hono adapter",
        installDir: "routes",
      })
    );
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({
        name: "@kitnai/hono",
        version: "1.0.0",
        dependencies: {
          hono: "^4.0.0",
          "@kitnai/core": "workspace:*",
        },
        peerDependencies: {
          ai: "^4.0.0",
        },
      })
    );
    await mkdir(join(testDir, "src"));
    await writeFile(join(testDir, "src", "index.ts"), "export {};");

    const result = await buildComponent(testDir);

    expect(result.dependencies).toContain("hono");
    expect(result.dependencies).toContain("ai");
    expect(result.dependencies).not.toContain("@kitnai/core");
  });

  test("uses sourceDir override for packages", async () => {
    await writeFile(
      join(testDir, "registry.json"),
      JSON.stringify({
        type: "kitn:package",
        name: "mylib",
        version: "1.0.0",
        description: "Custom source dir",
        sourceDir: "lib",
      })
    );
    await mkdir(join(testDir, "lib"));
    await writeFile(join(testDir, "lib", "main.ts"), "export const x = 1;");

    const result = await buildComponent(testDir);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("package/main.ts");
  });

  test("reads nested directories recursively for packages", async () => {
    await writeFile(
      join(testDir, "registry.json"),
      JSON.stringify({
        type: "kitn:package",
        name: "nested",
        version: "1.0.0",
        description: "Nested files",
      })
    );
    await mkdir(join(testDir, "src", "utils"), { recursive: true });
    await writeFile(join(testDir, "src", "index.ts"), "export {};");
    await writeFile(join(testDir, "src", "utils", "helpers.ts"), "export {};");

    const result = await buildComponent(testDir);

    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(["package/index.ts", "package/utils/helpers.ts"]);
  });

  test("passes through optional fields like envVars, categories, changelog", async () => {
    await writeFile(
      join(testDir, "registry.json"),
      JSON.stringify({
        type: "kitn:tool",
        name: "api-tool",
        version: "1.0.0",
        description: "API tool",
        files: ["api.ts"],
        envVars: { API_KEY: "Your API key" },
        categories: ["api", "http"],
        docs: "# API Tool\nUsage docs here.",
        changelog: [
          { version: "1.0.0", date: "2026-02-25", type: "initial", note: "Initial release" },
        ],
      })
    );
    await writeFile(join(testDir, "api.ts"), "export {};");

    const result = await buildComponent(testDir);

    expect(result.envVars).toEqual({ API_KEY: "Your API key" });
    expect(result.categories).toEqual(["api", "http"]);
    expect(result.docs).toBe("# API Tool\nUsage docs here.");
    expect(result.changelog).toHaveLength(1);
    expect(result.changelog![0].version).toBe("1.0.0");
  });
});
