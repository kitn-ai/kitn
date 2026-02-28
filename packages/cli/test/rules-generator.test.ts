import { describe, test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  renderTemplate,
  wrapContent,
  generateRulesFiles,
  fetchRulesConfig,
  fetchRulesTemplate,
  type RulesTool,
  type RulesConfig,
} from "../src/installers/rules-generator.js";
import type { KitnConfig } from "../src/utils/config.js";

// ---------- Helper fixtures ----------

const TEST_TEMPLATE = `# kitn

Components live in {base}.

- Agents: {agents}
- Tools: {tools}
- Skills: {skills}
- Storage: {storage}
- Crons: {crons}
`;

const TEST_ALIASES = {
  base: "src/ai",
  agents: "src/ai/agents",
  tools: "src/ai/tools",
  skills: "src/ai/skills",
  storage: "src/ai/storage",
  crons: "src/ai/crons",
};

const CUSTOM_ALIASES = {
  base: "lib/intelligence",
  agents: "lib/intelligence/bots",
  tools: "lib/intelligence/utilities",
  skills: "lib/intelligence/skills",
  storage: "lib/intelligence/storage",
  crons: "lib/intelligence/crons",
};

function makeConfig(overrides?: Partial<KitnConfig>): KitnConfig {
  return {
    runtime: "bun",
    framework: "hono",
    aliases: TEST_ALIASES,
    registries: {
      "@kitn": {
        url: "https://example.invalid/r/{type}/{name}.json",
        homepage: "https://kitn.ai",
        description: "Test registry",
      },
    },
    ...overrides,
  };
}

// ---------- renderTemplate ----------

describe("renderTemplate", () => {
  test("substitutes all placeholders with aliases", () => {
    const result = renderTemplate(TEST_TEMPLATE, TEST_ALIASES);
    expect(result).toContain("Components live in src/ai.");
    expect(result).toContain("- Agents: src/ai/agents");
    expect(result).toContain("- Tools: src/ai/tools");
    expect(result).toContain("- Skills: src/ai/skills");
    expect(result).toContain("- Storage: src/ai/storage");
    expect(result).toContain("- Crons: src/ai/crons");
  });

  test("substitutes with custom aliases", () => {
    const result = renderTemplate(TEST_TEMPLATE, CUSTOM_ALIASES);
    expect(result).toContain("Components live in lib/intelligence.");
    expect(result).toContain("- Agents: lib/intelligence/bots");
    expect(result).toContain("- Tools: lib/intelligence/utilities");
  });

  test("uses default base when base is undefined", () => {
    const aliases = { ...TEST_ALIASES, base: undefined };
    const result = renderTemplate("{base}/plugin.ts", aliases);
    expect(result).toBe("src/ai/plugin.ts");
  });

  test("uses default crons path when crons is undefined", () => {
    const aliases = { ...TEST_ALIASES, crons: undefined };
    const result = renderTemplate("{crons}/my-job.ts", aliases);
    expect(result).toBe("src/ai/crons/my-job.ts");
  });

  test("substitutes multiple occurrences of the same placeholder", () => {
    const result = renderTemplate("{base} and {base} again", TEST_ALIASES);
    expect(result).toBe("src/ai and src/ai again");
  });
});

// ---------- wrapContent ----------

describe("wrapContent", () => {
  test("plain format is passthrough", () => {
    const tool: RulesTool = {
      id: "claude-code",
      name: "Claude Code",
      filePath: "AGENTS.md",
      format: "plain",
    };
    const content = "# Hello World";
    expect(wrapContent(content, tool)).toBe("# Hello World");
  });

  test("mdc format wraps with valid frontmatter", () => {
    const tool: RulesTool = {
      id: "cursor",
      name: "Cursor",
      filePath: ".cursor/rules/kitn.mdc",
      format: "mdc",
      frontmatter: {
        description: "kitn conventions",
        globs: "src/ai/**/*.ts",
      },
    };
    const content = "# Rules content";
    const result = wrapContent(content, tool);

    expect(result).toMatch(/^---\n/);
    expect(result).toContain("description: kitn conventions");
    expect(result).toContain("globs: src/ai/**/*.ts");
    expect(result).toContain("---\n\n# Rules content");
  });

  test("mdc format without frontmatter is passthrough", () => {
    const tool: RulesTool = {
      id: "test",
      name: "Test",
      filePath: ".test",
      format: "mdc",
    };
    const content = "# Test";
    expect(wrapContent(content, tool)).toBe("# Test");
  });
});

// ---------- generateRulesFiles (integration, uses temp dir) ----------

describe("generateRulesFiles", () => {
  let tmpDir: string;

  const setup = async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "kitn-rules-test-"));
    return tmpDir;
  };

  const cleanup = async () => {
    await rm(tmpDir, { recursive: true, force: true });
  };

  test("writes selected files to correct paths", async () => {
    const cwd = await setup();
    try {
      const config = makeConfig();
      const written = await generateRulesFiles(cwd, config, ["claude-code", "cline"]);

      expect(written).toContain("AGENTS.md");
      expect(written).toContain(".clinerules");
      expect(written).not.toContain(".cursor/rules/kitn.mdc");

      // Verify files exist and have content
      const agentsMd = await readFile(join(cwd, "AGENTS.md"), "utf-8");
      expect(agentsMd.length).toBeGreaterThan(0);
      expect(agentsMd).toContain("kitn");

      const clinerules = await readFile(join(cwd, ".clinerules"), "utf-8");
      expect(clinerules.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  test("mdc files include frontmatter", async () => {
    const cwd = await setup();
    try {
      const config = makeConfig();
      const written = await generateRulesFiles(cwd, config, ["cursor"]);

      expect(written).toContain(".cursor/rules/kitn.mdc");

      const mdcContent = await readFile(join(cwd, ".cursor/rules/kitn.mdc"), "utf-8");
      expect(mdcContent).toMatch(/^---\n/);
      expect(mdcContent).toContain("description:");
      expect(mdcContent).toContain("globs:");
    } finally {
      await cleanup();
    }
  });

  test("creates nested directories as needed", async () => {
    const cwd = await setup();
    try {
      const config = makeConfig();
      // .cursor/rules/ and .github/ must be created
      const written = await generateRulesFiles(cwd, config, ["cursor", "github-copilot"]);

      expect(written).toContain(".cursor/rules/kitn.mdc");
      expect(written).toContain(".github/copilot-instructions.md");

      // Files should exist
      const cursorContent = await readFile(join(cwd, ".cursor/rules/kitn.mdc"), "utf-8");
      expect(cursorContent.length).toBeGreaterThan(0);

      const copilotContent = await readFile(join(cwd, ".github/copilot-instructions.md"), "utf-8");
      expect(copilotContent.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  test("is idempotent — running twice produces same result", async () => {
    const cwd = await setup();
    try {
      const config = makeConfig();

      await generateRulesFiles(cwd, config, ["claude-code", "cursor"]);
      const firstRun = await readFile(join(cwd, "AGENTS.md"), "utf-8");
      const firstCursor = await readFile(join(cwd, ".cursor/rules/kitn.mdc"), "utf-8");

      await generateRulesFiles(cwd, config, ["claude-code", "cursor"]);
      const secondRun = await readFile(join(cwd, "AGENTS.md"), "utf-8");
      const secondCursor = await readFile(join(cwd, ".cursor/rules/kitn.mdc"), "utf-8");

      expect(firstRun).toBe(secondRun);
      expect(firstCursor).toBe(secondCursor);
    } finally {
      await cleanup();
    }
  });

  test("renders template with project aliases", async () => {
    const cwd = await setup();
    try {
      const config = makeConfig({ aliases: CUSTOM_ALIASES });
      await generateRulesFiles(cwd, config, ["claude-code"]);

      const content = await readFile(join(cwd, "AGENTS.md"), "utf-8");
      expect(content).toContain("lib/intelligence");
      expect(content).not.toContain("{base}");
      expect(content).not.toContain("{agents}");
    } finally {
      await cleanup();
    }
  });
});

// ---------- Offline fallback ----------

describe("offline fallback", () => {
  test("fetchRulesConfig returns fallback on network failure", async () => {
    // Use a registry URL that will fail
    const registries = {
      "@kitn": "https://does-not-exist.invalid/r/{type}/{name}.json",
    };
    const config = await fetchRulesConfig(registries);

    expect(config.version).toBe("1.0.0");
    expect(config.tools.length).toBeGreaterThan(0);
    expect(config.tools.some((t) => t.id === "claude-code")).toBe(true);
  });

  test("fetchRulesTemplate returns fallback on network failure", async () => {
    const registries = {
      "@kitn": "https://does-not-exist.invalid/r/{type}/{name}.json",
    };
    const template = await fetchRulesTemplate(registries);

    expect(template.length).toBeGreaterThan(0);
    expect(template).toContain("{base}");
    expect(template).toContain("kitn");
  });
});
