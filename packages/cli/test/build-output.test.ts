import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanForComponents,
  writeRegistryOutput,
} from "../src/registry/build-output.js";
import type { RegistryItem } from "../src/registry/schema.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "kitn-build-output-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true });
});

describe("scanForComponents", () => {
  test("finds registry.json files in directory tree", async () => {
    // Create two component directories at different levels
    await mkdir(join(testDir, "packages", "core"), { recursive: true });
    await mkdir(join(testDir, "packages", "hono"), { recursive: true });
    await writeFile(
      join(testDir, "packages", "core", "registry.json"),
      JSON.stringify({ type: "kitn:package" })
    );
    await writeFile(
      join(testDir, "packages", "hono", "registry.json"),
      JSON.stringify({ type: "kitn:package" })
    );

    const result = await scanForComponents(testDir);

    expect(result).toHaveLength(2);
    expect(result).toContain(join(testDir, "packages", "core"));
    expect(result).toContain(join(testDir, "packages", "hono"));
  });

  test("skips node_modules and dist directories", async () => {
    // Create a valid component
    await mkdir(join(testDir, "components", "valid"), { recursive: true });
    await writeFile(
      join(testDir, "components", "valid", "registry.json"),
      JSON.stringify({ type: "kitn:tool" })
    );

    // Create registry.json inside node_modules (should be skipped)
    await mkdir(join(testDir, "node_modules", "some-pkg"), { recursive: true });
    await writeFile(
      join(testDir, "node_modules", "some-pkg", "registry.json"),
      JSON.stringify({ type: "kitn:tool" })
    );

    // Create registry.json inside dist (should be skipped)
    await mkdir(join(testDir, "dist", "output"), { recursive: true });
    await writeFile(
      join(testDir, "dist", "output", "registry.json"),
      JSON.stringify({ type: "kitn:tool" })
    );

    const result = await scanForComponents(testDir);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(join(testDir, "components", "valid"));
  });

  test("finds from specific paths (paths argument)", async () => {
    // Create several component directories
    await mkdir(join(testDir, "packages", "core"), { recursive: true });
    await mkdir(join(testDir, "packages", "hono"), { recursive: true });
    await mkdir(join(testDir, "packages", "cli"), { recursive: true });
    await writeFile(
      join(testDir, "packages", "core", "registry.json"),
      JSON.stringify({ type: "kitn:package" })
    );
    await writeFile(
      join(testDir, "packages", "hono", "registry.json"),
      JSON.stringify({ type: "kitn:package" })
    );
    await writeFile(
      join(testDir, "packages", "cli", "registry.json"),
      JSON.stringify({ type: "kitn:package" })
    );

    // Pass only two paths — direct component directories
    const result = await scanForComponents(testDir, [
      join(testDir, "packages", "core"),
      join(testDir, "packages", "hono"),
    ]);

    expect(result).toHaveLength(2);
    expect(result).toContain(join(testDir, "packages", "core"));
    expect(result).toContain(join(testDir, "packages", "hono"));
    expect(result).not.toContain(join(testDir, "packages", "cli"));
  });

  test("scans one level of subdirectories when path does not directly contain registry.json", async () => {
    // This handles `kitn build packages/*` where the shell expands to `packages/`
    await mkdir(join(testDir, "packages", "core"), { recursive: true });
    await mkdir(join(testDir, "packages", "hono"), { recursive: true });
    await writeFile(
      join(testDir, "packages", "core", "registry.json"),
      JSON.stringify({ type: "kitn:package" })
    );
    await writeFile(
      join(testDir, "packages", "hono", "registry.json"),
      JSON.stringify({ type: "kitn:package" })
    );

    // Pass the parent directory — should scan one level deep
    const result = await scanForComponents(testDir, [
      join(testDir, "packages"),
    ]);

    expect(result).toHaveLength(2);
    expect(result).toContain(join(testDir, "packages", "core"));
    expect(result).toContain(join(testDir, "packages", "hono"));
  });
});

describe("writeRegistryOutput", () => {
  test("writes component JSON and registry index", async () => {
    const outputDir = join(testDir, "output");
    const items: RegistryItem[] = [
      {
        name: "weather",
        type: "kitn:tool",
        description: "Get weather info",
        version: "1.0.0",
        files: [
          {
            path: "tools/weather.ts",
            content: 'export const weather = "sunny";',
            type: "kitn:tool",
          },
        ],
        categories: ["weather"],
      },
    ];

    const result = await writeRegistryOutput(outputDir, items);

    // Should have written latest + versioned + registry index
    expect(result.written).toContain("tools/weather.json");
    expect(result.written).toContain("tools/weather@1.0.0.json");
    expect(result.written).toContain("registry.json");

    // Verify the latest file contents
    const latestRaw = await readFile(
      join(outputDir, "tools", "weather.json"),
      "utf-8"
    );
    const latest = JSON.parse(latestRaw);
    expect(latest.name).toBe("weather");
    expect(latest.version).toBe("1.0.0");
    expect(latest.files).toHaveLength(1);

    // Verify the versioned file contents
    const versionedRaw = await readFile(
      join(outputDir, "tools", "weather@1.0.0.json"),
      "utf-8"
    );
    const versioned = JSON.parse(versionedRaw);
    expect(versioned.name).toBe("weather");
    expect(versioned.version).toBe("1.0.0");

    // Verify the registry index
    const indexRaw = await readFile(
      join(outputDir, "registry.json"),
      "utf-8"
    );
    const index = JSON.parse(indexRaw);
    expect(index.version).toBe("1");
    expect(index.items).toHaveLength(1);
    expect(index.items[0].name).toBe("weather");
    expect(index.items[0].type).toBe("kitn:tool");
    expect(index.items[0].description).toBe("Get weather info");
    expect(index.items[0].version).toBe("1.0.0");
    expect(index.items[0].versions).toContain("1.0.0");
    expect(index.items[0].categories).toEqual(["weather"]);
    // Index items should NOT have file content
    expect(index.items[0].files).toBeUndefined();
  });

  test("does not overwrite existing versioned files", async () => {
    const outputDir = join(testDir, "output");

    // Pre-create the versioned file with different content
    await mkdir(join(outputDir, "tools"), { recursive: true });
    const originalContent = JSON.stringify({ name: "weather", version: "1.0.0", original: true });
    await writeFile(
      join(outputDir, "tools", "weather@1.0.0.json"),
      originalContent
    );

    const items: RegistryItem[] = [
      {
        name: "weather",
        type: "kitn:tool",
        description: "Get weather info",
        version: "1.0.0",
        files: [
          {
            path: "tools/weather.ts",
            content: 'export const weather = "rainy";',
            type: "kitn:tool",
          },
        ],
      },
    ];

    const result = await writeRegistryOutput(outputDir, items);

    // The versioned file should be skipped
    expect(result.skipped).toContain("tools/weather@1.0.0.json");
    expect(result.written).not.toContain("tools/weather@1.0.0.json");

    // The latest file should still be written (always overwritten)
    expect(result.written).toContain("tools/weather.json");

    // Verify the versioned file was NOT overwritten
    const versionedRaw = await readFile(
      join(outputDir, "tools", "weather@1.0.0.json"),
      "utf-8"
    );
    const versioned = JSON.parse(versionedRaw);
    expect(versioned.original).toBe(true);
  });

  test("collects all existing versioned files into versions array", async () => {
    const outputDir = join(testDir, "output");

    // Pre-create an older versioned file
    await mkdir(join(outputDir, "tools"), { recursive: true });
    await writeFile(
      join(outputDir, "tools", "weather@0.9.0.json"),
      JSON.stringify({ name: "weather", version: "0.9.0" })
    );

    const items: RegistryItem[] = [
      {
        name: "weather",
        type: "kitn:tool",
        description: "Get weather info",
        version: "1.0.0",
        files: [
          {
            path: "tools/weather.ts",
            content: 'export const weather = "sunny";',
            type: "kitn:tool",
          },
        ],
      },
    ];

    const result = await writeRegistryOutput(outputDir, items);

    // Verify the registry index contains both versions
    const indexRaw = await readFile(
      join(outputDir, "registry.json"),
      "utf-8"
    );
    const index = JSON.parse(indexRaw);
    expect(index.items[0].versions).toContain("0.9.0");
    expect(index.items[0].versions).toContain("1.0.0");
  });
});
