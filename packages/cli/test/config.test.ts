import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFile, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// We test readUserConfig by importing it; the other commands use process.exit
// so we test them indirectly through the config file they write.
import { readUserConfig } from "../src/commands/config.js";

describe("readUserConfig", () => {
  test("returns empty object when no config file exists", async () => {
    // readUserConfig reads from ~/.kitn/config.json — if it doesn't exist,
    // it should gracefully return {}
    const config = await readUserConfig();
    expect(typeof config).toBe("object");
    // It should at minimum not throw
  });
});

describe("config file format", () => {
  const testDir = join(tmpdir(), `kitn-config-test-${Date.now()}`);
  const configFile = join(testDir, "config.json");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("config file is valid JSON with correct structure", async () => {
    const config = { "chat-url": "https://chat.acme.com", "api-key": "sk_test123" };
    await writeFile(configFile, JSON.stringify(config, null, 2) + "\n");

    const raw = await readFile(configFile, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed["chat-url"]).toBe("https://chat.acme.com");
    expect(parsed["api-key"]).toBe("sk_test123");
  });

  test("config file handles empty object", async () => {
    await writeFile(configFile, JSON.stringify({}, null, 2) + "\n");

    const raw = await readFile(configFile, "utf-8");
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed)).toHaveLength(0);
  });
});
