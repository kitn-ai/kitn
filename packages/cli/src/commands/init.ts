import * as p from "@clack/prompts";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config.js";

export async function initCommand() {
  p.intro(pc.bgCyan(pc.black(" kitn ")));

  const cwd = process.cwd();

  const existing = await readConfig(cwd);
  if (existing) {
    p.log.warn("kitn.json already exists in this directory.");
    const shouldContinue = await p.confirm({
      message: "Overwrite existing configuration?",
      initialValue: false,
    });
    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.cancel("Init cancelled.");
      process.exit(0);
    }
  }

  const runtime = await p.select({
    message: "Which runtime do you use?",
    options: [
      { value: "bun", label: "Bun", hint: "recommended" },
      { value: "node", label: "Node.js" },
      { value: "deno", label: "Deno" },
    ],
  });
  if (p.isCancel(runtime)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const framework = await p.select({
    message: "Which framework are you using?",
    options: [
      { value: "hono", label: "Hono", hint: "recommended" },
      { value: "cloudflare", label: "Cloudflare Workers", hint: "coming soon" },
      { value: "elysia", label: "Elysia", hint: "coming soon" },
      { value: "fastify", label: "Fastify", hint: "coming soon" },
      { value: "express", label: "Express", hint: "coming soon" },
    ],
  });
  if (p.isCancel(framework)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const base = await p.text({
    message: "Where should kitn packages be installed?",
    initialValue: "src/ai",
    placeholder: "src/ai",
  });
  if (p.isCancel(base)) {
    p.cancel("Init cancelled.");
    process.exit(0);
  }

  const baseDir = base as string;
  const config = {
    runtime: runtime as "bun" | "node" | "deno",
    framework: framework as "hono" | "cloudflare" | "elysia" | "fastify" | "express",
    aliases: {
      base: baseDir,
      agents: `${baseDir}/agents`,
      tools: `${baseDir}/tools`,
      skills: `${baseDir}/skills`,
      storage: `${baseDir}/storage`,
    },
    registries: {
      "@kitn": "https://kitn-ai.github.io/registry/r/{type}/{name}.json",
    },
  };

  const s = p.spinner();
  s.start("Writing kitn.json");
  await writeConfig(cwd, config);
  s.stop("Created kitn.json");

  p.outro(pc.green("Done! Run `kitn add core` to install the engine, then `kitn add routes` for HTTP routes."));
}
