import * as p from "@clack/prompts";
import pc from "picocolors";
import { newProject, VALID_TEMPLATES } from "@kitnai/cli-core";

interface NewOptions {
  framework?: string;
  runtime?: string;
  yes?: boolean;
}

export async function newCommand(nameArg?: string, opts: NewOptions = {}) {
  p.intro(pc.bgCyan(pc.black(" kitn new ")));

  const targetDir = process.cwd();

  // --- Resolve name ---
  let name: string;
  if (nameArg) {
    name = nameArg;
  } else if (opts.yes) {
    p.log.error("Project name is required with --yes flag.");
    process.exit(1);
  } else {
    const input = await p.text({
      message: "What should your project be called?",
      placeholder: "my-app",
      initialValue: "my-app",
      validate: (v) => {
        if (!v.trim()) return "Project name is required";
        if (v !== "." && /[^a-z0-9-_]/.test(v))
          return "Use lowercase letters, numbers, hyphens, underscores only";
      },
    });
    if (p.isCancel(input)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    name = input as string;
  }

  const useCurrentDir = name === ".";

  // --- Resolve framework (template) ---
  let framework: string;
  if (opts.framework) {
    if (!VALID_TEMPLATES.includes(opts.framework as any)) {
      p.log.error(
        `Invalid framework: ${opts.framework}. Available: ${VALID_TEMPLATES.join(", ")}`,
      );
      process.exit(1);
    }
    framework = opts.framework;
  } else if (opts.yes) {
    framework = "hono";
  } else {
    const selected = await p.select({
      message: "Which framework?",
      options: [
        {
          value: "hono",
          label: "Hono",
          hint: "recommended — with OpenAPI + Scalar docs",
        },
        // { value: "elysia", label: "Elysia", hint: "experimental" },
      ],
    });
    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    framework = selected as string;
  }

  // --- Resolve runtime ---
  let runtime: string;
  if (opts.runtime) {
    if (!["bun", "node", "deno"].includes(opts.runtime)) {
      p.log.error(
        `Invalid runtime: ${opts.runtime}. Must be bun, node, or deno.`,
      );
      process.exit(1);
    }
    runtime = opts.runtime;
  } else if (opts.yes) {
    runtime = "bun";
  } else {
    const selected = await p.select({
      message: "Which runtime?",
      options: [
        { value: "bun", label: "Bun", hint: "recommended" },
        { value: "node", label: "Node.js" },
        { value: "deno", label: "Deno" },
      ],
    });
    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    runtime = selected as string;
  }

  // --- Scaffold ---
  const displayName = useCurrentDir ? "project" : name;
  const s = p.spinner();
  s.start(`Creating ${pc.bold(displayName)}`);

  let result;
  try {
    result = await newProject({ name, targetDir, framework, runtime });
  } catch (err: any) {
    s.stop(pc.red("Failed"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop(`Created ${pc.bold(displayName)}`);

  // --- Summary ---
  p.log.success(
    `${pc.bold(String(result.filesCreated.length))} files created`,
  );

  if (result.npmDeps.length > 0) {
    p.log.info(
      `npm dependencies to install: ${result.npmDeps.map((d) => pc.cyan(d)).join(", ")}`,
    );
  }

  // --- Install dependencies ---
  let didInstall = false;
  if (opts.yes) {
    didInstall = true;
  } else {
    const confirm = await p.confirm({
      message: "Install dependencies?",
      initialValue: true,
    });
    if (!p.isCancel(confirm) && confirm) {
      didInstall = true;
    }
  }

  if (didInstall) {
    const installS = p.spinner();
    const cmd = runtime === "bun" ? "bun install" : "npm install";
    installS.start(`Running ${pc.bold(cmd)}`);
    try {
      const { execSync } = await import("child_process");
      execSync(cmd, { cwd: result.projectPath, stdio: "pipe" });
      installS.stop("Dependencies installed");
    } catch {
      installS.stop(pc.yellow("Install failed — run manually"));
      didInstall = false;
    }
  }

  // --- Next steps ---
  const runCmd = runtime === "bun" ? "bun" : "npm run";
  const installCmd = runtime === "bun" ? "bun install" : "npm install";

  const nextSteps: string[] = [];
  if (!useCurrentDir) {
    nextSteps.push(`cd ${name}`);
  }
  if (!didInstall) {
    nextSteps.push(installCmd);
  }
  nextSteps.push(
    `cp .env.example .env  ${pc.dim("# add your OPENROUTER_API_KEY")}`,
  );
  nextSteps.push(`${runCmd} dev`);

  p.note(nextSteps.join("\n"), "Next steps:");

  p.log.message(
    [
      pc.bold("Add your first agent:"),
      `  ${pc.cyan("kitn add weather-agent")}`,
      "",
      pc.bold("Browse all components:"),
      `  ${pc.cyan("kitn list")}`,
    ].join("\n"),
  );

  p.outro("Done!");
}
