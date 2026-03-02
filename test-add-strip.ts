import { addComponents } from "@kitnai/cli-core";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const dir = await mkdtemp(join(tmpdir(), "kitn-mcp-test-"));

await writeFile(join(dir, "kitn.json"), JSON.stringify({
  runtime: "bun",
  aliases: { agents: "src/ai/agents", tools: "src/ai/tools", skills: "src/ai/skills", storage: "src/ai/storage" },
  registries: { "@kitn": "https://kitn-ai.github.io/kitn/r/{type}/{name}.json" },
}, null, 2));

const result = await addComponents({ components: ["weather-agent"], cwd: dir, overwrite: true });

const summary = {
  ...result,
  resolved: result.resolved.map(({ files, ...rest }) => ({
    ...rest,
    files: files.map(({ content: _content, ...file }) => file),
  })),
};

const raw = JSON.stringify(result, null, 2);
const stripped = JSON.stringify(summary, null, 2);

console.log(`Raw response size:      ${raw.length.toLocaleString()} chars`);
console.log(`Stripped response size: ${stripped.length.toLocaleString()} chars`);
console.log(`Reduction:              ${((1 - stripped.length / raw.length) * 100).toFixed(1)}%`);

const resolvedStr = JSON.stringify(summary.resolved);
const hasContentInResolved = resolvedStr.includes('"content":');
console.log(`\nContent fields in resolved: ${hasContentInResolved ? "YES (BUG!)" : "none ✓"}`);
console.log(`resolved[0].files[0] keys: ${Object.keys(summary.resolved[0]?.files?.[0] ?? {}).join(", ")}`);

await rm(dir, { recursive: true });
