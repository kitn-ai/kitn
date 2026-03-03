import { describe, test, expect } from "bun:test";
import { parseRulesSections, findRelevantSections } from "../src/rules/sections.js";
import type { RulesSection } from "../src/rules/sections.js";

// ---------- Test template ----------

const TEST_TEMPLATE = `# kitn AI Agent Framework

This project uses **kitn** to build multi-agent AI systems.

## Project Structure

AI components live under the \`src/ai\` directory:

\`\`\`
src/ai/
  plugin.ts
  index.ts
  agents/
  tools/
\`\`\`

## Component Patterns

### Agent

Agents use \`registerAgent()\` for self-registration.

### Tool

Tools use the Vercel AI SDK \`tool()\` function.

### Skill

Skills are markdown files with YAML frontmatter.

## Wiring Tools to Agents

To give an agent access to a tool, import the tool and add it.

## Import Conventions

- Always use \`.js\` extension in relative imports
- Use \`@kitn/core\` for core framework imports

## CLI Quick Reference

| Command | Description |
|---------|-------------|
| \`kitn init\` | Initialize kitn |
| \`kitn add\` | Install a component |

## Common Tasks

### Create a new agent

\`\`\`bash
kitn create agent my-agent
\`\`\`
`;

// ---------- parseRulesSections ----------

describe("parseRulesSections", () => {
  test("splits template into sections on ## headers", () => {
    const sections = parseRulesSections(TEST_TEMPLATE);
    expect(sections.length).toBeGreaterThanOrEqual(6);
  });

  test("first section captures the introduction with H1 title", () => {
    const sections = parseRulesSections(TEST_TEMPLATE);
    const intro = sections[0];
    expect(intro.title).toBe("kitn AI Agent Framework");
    expect(intro.content).toContain("multi-agent AI systems");
  });

  test("extracts section titles correctly", () => {
    const sections = parseRulesSections(TEST_TEMPLATE);
    const titles = sections.map((s) => s.title);
    expect(titles).toContain("Project Structure");
    expect(titles).toContain("Component Patterns");
    expect(titles).toContain("Wiring Tools to Agents");
    expect(titles).toContain("Import Conventions");
    expect(titles).toContain("CLI Quick Reference");
    expect(titles).toContain("Common Tasks");
  });

  test("section content includes the ## header line", () => {
    const sections = parseRulesSections(TEST_TEMPLATE);
    const structure = sections.find((s) => s.title === "Project Structure");
    expect(structure).toBeDefined();
    expect(structure!.content).toStartWith("## Project Structure");
  });

  test("assigns keywords based on title", () => {
    const sections = parseRulesSections(TEST_TEMPLATE);
    const structure = sections.find((s) => s.title === "Project Structure");
    expect(structure).toBeDefined();
    expect(structure!.keywords).toContain("init");
    expect(structure!.keywords).toContain("setup");
    expect(structure!.keywords).toContain("project");
  });

  test("component patterns section has agent/tool/skill keywords", () => {
    const sections = parseRulesSections(TEST_TEMPLATE);
    const components = sections.find((s) => s.title === "Component Patterns");
    expect(components).toBeDefined();
    expect(components!.keywords).toContain("component");
  });

  test("import conventions section has import keywords", () => {
    const sections = parseRulesSections(TEST_TEMPLATE);
    const imports = sections.find((s) => s.title === "Import Conventions");
    expect(imports).toBeDefined();
    expect(imports!.keywords).toContain("import");
    expect(imports!.keywords).toContain("conventions");
  });

  test("handles empty template", () => {
    const sections = parseRulesSections("");
    expect(sections).toEqual([]);
  });

  test("handles template with no ## sections", () => {
    const sections = parseRulesSections("# Title\n\nSome content here.");
    expect(sections.length).toBe(1);
    expect(sections[0].title).toBe("Title");
  });

  test("handles template with only ## sections (no intro)", () => {
    const template = "## Section One\n\nContent one.\n\n## Section Two\n\nContent two.";
    const sections = parseRulesSections(template);
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe("Section One");
    expect(sections[1].title).toBe("Section Two");
  });
});

// ---------- findRelevantSections ----------

describe("findRelevantSections", () => {
  let sections: RulesSection[];

  // Parse once, reuse across tests
  sections = parseRulesSections(TEST_TEMPLATE);

  test("finds sections by keyword match", () => {
    const results = findRelevantSections(sections, "How do I set up my project?");
    expect(results.length).toBeGreaterThan(0);
    const titles = results.map((s) => s.title);
    expect(titles).toContain("Project Structure");
  });

  test("finds tool-related sections", () => {
    const results = findRelevantSections(sections, "How do I define a tool?");
    expect(results.length).toBeGreaterThan(0);
    const titles = results.map((s) => s.title);
    // Should match sections with "tool" keyword
    expect(titles.some((t) => t.includes("Tool") || t.includes("Wiring") || t.includes("Component"))).toBe(true);
  });

  test("finds import convention sections", () => {
    const results = findRelevantSections(sections, "What are the import conventions?");
    expect(results.length).toBeGreaterThan(0);
    const titles = results.map((s) => s.title);
    expect(titles).toContain("Import Conventions");
  });

  test("returns multiple matching sections", () => {
    // "agent" keyword should match multiple sections
    const results = findRelevantSections(sections, "How do I create an agent?");
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test("falls back to fuzzy title matching when no keyword matches", () => {
    const results = findRelevantSections(sections, "What about the quick reference?");
    expect(results.length).toBeGreaterThan(0);
    const titles = results.map((s) => s.title);
    expect(titles).toContain("CLI Quick Reference");
  });

  test("returns empty array when nothing matches", () => {
    const results = findRelevantSections(sections, "quantum physics entanglement");
    expect(results).toEqual([]);
  });

  test("matching is case-insensitive", () => {
    const results = findRelevantSections(sections, "IMPORT CONVENTIONS");
    expect(results.length).toBeGreaterThan(0);
  });

  test("works with single-word topics", () => {
    const results = findRelevantSections(sections, "init");
    expect(results.length).toBeGreaterThan(0);
  });
});
