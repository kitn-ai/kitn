import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { writeConfig, readConfig, type KitnConfig } from "../src/utils/config.js";
import { registryAddCommand, registryRemoveCommand, registryListCommand } from "../src/commands/registry.js";
import { RegistryFetcher } from "../src/registry/fetcher.js";

function makeConfig(overrides: Partial<KitnConfig> = {}): KitnConfig {
  return {
    runtime: "bun",
    aliases: { agents: "src/ai/agents", tools: "src/ai/tools", skills: "src/ai/skills", storage: "src/ai/storage" },
    registries: { "@kitn": "https://kitn-ai.github.io/registry/r/{type}/{name}.json" },
    ...overrides,
  };
}

describe("registryAddCommand", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kitn-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("adds a new registry to config", async () => {
    await writeConfig(dir, makeConfig());
    await registryAddCommand("@myteam", "https://myteam.dev/r/{type}/{name}.json", { cwd: dir });
    const config = await readConfig(dir);
    expect(config!.registries["@myteam"]).toBe("https://myteam.dev/r/{type}/{name}.json");
    expect(config!.registries["@kitn"]).toBeDefined();
  });

  test("stores rich entry with --homepage and --description", async () => {
    await writeConfig(dir, makeConfig());
    await registryAddCommand("@acme", "https://acme.dev/r/{type}/{name}.json", {
      cwd: dir,
      homepage: "https://acme.dev",
      description: "Acme AI components",
    });
    const config = await readConfig(dir);
    const entry = config!.registries["@acme"];
    expect(typeof entry).toBe("object");
    expect((entry as any).url).toBe("https://acme.dev/r/{type}/{name}.json");
    expect((entry as any).homepage).toBe("https://acme.dev");
    expect((entry as any).description).toBe("Acme AI components");
  });

  test("stores plain URL string when no extra fields provided", async () => {
    await writeConfig(dir, makeConfig());
    await registryAddCommand("@myteam", "https://myteam.dev/r/{type}/{name}.json", { cwd: dir });
    const config = await readConfig(dir);
    expect(typeof config!.registries["@myteam"]).toBe("string");
  });

  test("rejects URL missing {type} placeholder", async () => {
    await writeConfig(dir, makeConfig());
    await expect(
      registryAddCommand("@myteam", "https://myteam.dev/r/{name}.json", { cwd: dir })
    ).rejects.toThrow("{type}");
  });

  test("rejects URL missing {name} placeholder", async () => {
    await writeConfig(dir, makeConfig());
    await expect(
      registryAddCommand("@myteam", "https://myteam.dev/r/{type}/foo.json", { cwd: dir })
    ).rejects.toThrow("{name}");
  });

  test("rejects namespace without @ prefix", async () => {
    await writeConfig(dir, makeConfig());
    await expect(
      registryAddCommand("myteam", "https://myteam.dev/r/{type}/{name}.json", { cwd: dir })
    ).rejects.toThrow("@");
  });

  test("refuses to overwrite existing namespace without flag", async () => {
    await writeConfig(dir, makeConfig());
    await expect(
      registryAddCommand("@kitn", "https://other.dev/r/{type}/{name}.json", { cwd: dir })
    ).rejects.toThrow("already configured");
  });

  test("overwrites existing namespace with --overwrite", async () => {
    await writeConfig(dir, makeConfig());
    await registryAddCommand("@kitn", "https://other.dev/r/{type}/{name}.json", { cwd: dir, overwrite: true });
    const config = await readConfig(dir);
    expect(config!.registries["@kitn"]).toBe("https://other.dev/r/{type}/{name}.json");
  });

  test("errors when no kitn.json exists", async () => {
    await expect(
      registryAddCommand("@myteam", "https://myteam.dev/r/{type}/{name}.json", { cwd: dir })
    ).rejects.toThrow("kitn.json");
  });
});

describe("registryRemoveCommand", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kitn-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("removes a registry from config", async () => {
    const config = makeConfig({
      registries: {
        "@kitn": "https://kitn-ai.github.io/registry/r/{type}/{name}.json",
        "@myteam": "https://myteam.dev/r/{type}/{name}.json",
      },
    });
    await writeConfig(dir, config);
    await registryRemoveCommand("@myteam", { cwd: dir });
    const updated = await readConfig(dir);
    expect(updated!.registries["@myteam"]).toBeUndefined();
    expect(updated!.registries["@kitn"]).toBeDefined();
  });

  test("refuses to remove @kitn without --force", async () => {
    await writeConfig(dir, makeConfig());
    await expect(registryRemoveCommand("@kitn", { cwd: dir })).rejects.toThrow("default");
  });

  test("removes @kitn with --force", async () => {
    await writeConfig(dir, makeConfig());
    await registryRemoveCommand("@kitn", { cwd: dir, force: true });
    const config = await readConfig(dir);
    expect(config!.registries["@kitn"]).toBeUndefined();
  });

  test("errors when namespace not found", async () => {
    await writeConfig(dir, makeConfig());
    await expect(registryRemoveCommand("@unknown", { cwd: dir })).rejects.toThrow("not configured");
  });

  test("warns about installed components from removed registry", async () => {
    const config = makeConfig({
      registries: {
        "@kitn": "https://kitn-ai.github.io/registry/r/{type}/{name}.json",
        "@myteam": "https://myteam.dev/r/{type}/{name}.json",
      },
      installed: {
        "@myteam/custom-agent": {
          registry: "@myteam",
          version: "1.0.0",
          installedAt: new Date().toISOString(),
          files: ["src/ai/agents/custom-agent.ts"],
          hash: "abc123",
        },
      },
    });
    await writeConfig(dir, config);
    const result = await registryRemoveCommand("@myteam", { cwd: dir });
    expect(result.affectedComponents).toEqual(["@myteam/custom-agent"]);
  });
});

describe("registryListCommand", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kitn-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  test("returns all registries with URLs extracted", async () => {
    const config = makeConfig({
      registries: {
        "@kitn": "https://kitn-ai.github.io/registry/r/{type}/{name}.json",
        "@myteam": "https://myteam.dev/r/{type}/{name}.json",
      },
    });
    await writeConfig(dir, config);
    const result = await registryListCommand({ cwd: dir });
    expect(result).toHaveLength(2);
    expect(result[0].namespace).toBe("@kitn");
    expect(result[0].url).toBe("https://kitn-ai.github.io/registry/r/{type}/{name}.json");
    expect(result[1].namespace).toBe("@myteam");
    expect(result[1].url).toBe("https://myteam.dev/r/{type}/{name}.json");
  });

  test("returns homepage and description for rich entries", async () => {
    const config = makeConfig({
      registries: {
        "@kitn": {
          url: "https://kitn-ai.github.io/registry/r/{type}/{name}.json",
          homepage: "https://kitn.ai",
          description: "Official kitn components",
        },
      },
    });
    await writeConfig(dir, config);
    const result = await registryListCommand({ cwd: dir });
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://kitn-ai.github.io/registry/r/{type}/{name}.json");
    expect(result[0].homepage).toBe("https://kitn.ai");
    expect(result[0].description).toBe("Official kitn components");
  });

  test("returns empty array when no registries", async () => {
    await writeConfig(dir, makeConfig({ registries: {} }));
    const result = await registryListCommand({ cwd: dir });
    expect(result).toEqual([]);
  });
});

describe("multi-registry fetchIndex", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetchIndex resolves correct URL per namespace", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      calls.push(urlStr);
      return new Response(JSON.stringify({ version: "1.0", items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const fetcher = new RegistryFetcher({
      "@kitn": "https://kitn.example.com/r/{type}/{name}.json",
      "@acme": "https://acme.example.com/r/{type}/{name}.json",
    });

    await fetcher.fetchIndex("@kitn");
    await fetcher.fetchIndex("@acme");

    expect(calls).toContain("https://kitn.example.com/r/registry.json");
    expect(calls).toContain("https://acme.example.com/r/registry.json");
  });

  test("fetchIndex works with rich registry entries", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      calls.push(urlStr);
      return new Response(JSON.stringify({ version: "1.0", items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const fetcher = new RegistryFetcher({
      "@kitn": {
        url: "https://kitn.example.com/r/{type}/{name}.json",
        homepage: "https://kitn.ai",
        description: "Official kitn components",
      },
    });

    await fetcher.fetchIndex("@kitn");
    expect(calls).toContain("https://kitn.example.com/r/registry.json");
  });

  test("fetching multiple registries returns independent results", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("kitn.example.com")) {
        return new Response(JSON.stringify({
          version: "1.0",
          items: [{ name: "weather-agent", type: "kitn:agent", description: "Weather" }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (urlStr.includes("acme.example.com")) {
        return new Response(JSON.stringify({
          version: "1.0",
          items: [{ name: "custom-tool", type: "kitn:tool", description: "Custom" }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const fetcher = new RegistryFetcher({
      "@kitn": "https://kitn.example.com/r/{type}/{name}.json",
      "@acme": "https://acme.example.com/r/{type}/{name}.json",
    });

    const kitnIndex = await fetcher.fetchIndex("@kitn");
    const acmeIndex = await fetcher.fetchIndex("@acme");

    expect(kitnIndex.items).toHaveLength(1);
    expect(kitnIndex.items[0].name).toBe("weather-agent");
    expect(acmeIndex.items).toHaveLength(1);
    expect(acmeIndex.items[0].name).toBe("custom-tool");
  });

  test("fetchIndex throws for failed registry", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Server Error", { status: 500, statusText: "Internal Server Error" });
    }) as typeof fetch;

    const fetcher = new RegistryFetcher({
      "@kitn": "https://kitn.example.com/r/{type}/{name}.json",
    });

    await expect(fetcher.fetchIndex("@kitn")).rejects.toThrow("Failed to fetch registry index");
  });

  test("fetchIndex throws for unknown namespace", () => {
    const fetcher = new RegistryFetcher({
      "@kitn": "https://kitn.example.com/r/{type}/{name}.json",
    });

    expect(() => fetcher.fetchIndex("@unknown")).toThrow("No registry configured for @unknown");
  });
});
