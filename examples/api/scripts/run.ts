/**
 * Interactive test runner — pick which test suites to run.
 *
 * Usage:
 *   bun scripts/run.ts          # interactive picker
 *   bun scripts/run.ts --all    # run everything
 *   bun scripts/run.ts 01 03    # run specific suites by number
 */
import * as p from "@clack/prompts";
import pc from "picocolors";
import { spawn } from "child_process";
import path from "path";

const SCRIPTS_DIR = path.dirname(new URL(import.meta.url).pathname);

const suites = [
  { value: "01-auth", label: "01  Authentication", hint: "API key validation" },
  { value: "02-tools", label: "02  Tools", hint: "echo, weather, calculator, HN, web search" },
  { value: "03-agents", label: "03  Agents", hint: "general, guarded, orchestrator" },
  { value: "04-conversations", label: "04  Conversations", hint: "create, recall, compact, delete" },
  { value: "05-memory", label: "05  Memory", hint: "namespace CRUD" },
  { value: "06-commands", label: "06  Commands", hint: "create, run, delete" },
  { value: "07-crons", label: "07  Cron Scheduling", hint: "create, trigger, history, delete" },
  { value: "08-async-jobs", label: "08  Async Jobs", hint: "start, poll, cancel, delete" },
  { value: "09-prompt-overrides", label: "09  Prompt Overrides", hint: "set pirate, reset" },
  { value: "10-skills", label: "10  Skills", hint: "CRUD operations" },
  { value: "11-generate", label: "11  Generate", hint: "direct text generation" },
  { value: "12-mcp-server", label: "12  MCP Server", hint: "JSON-RPC tools/list, tools/call" },
  { value: "13-docs-agent", label: "13  Docs Agent", hint: "Context7 MCP (needs MCP_CONTEXT7)" },
  { value: "14-voice", label: "14  Voice", hint: "TTS, speakers (needs OPENAI_API_KEY)" },
];

async function runScript(name: string): Promise<{ ok: boolean; duration: number }> {
  const file = path.join(SCRIPTS_DIR, `${name}.ts`);
  const start = performance.now();

  return new Promise((resolve) => {
    const child = spawn("bun", [file], {
      stdio: "inherit",
      env: { ...process.env },
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, duration: Math.round(performance.now() - start) });
    });
    child.on("error", () => {
      resolve({ ok: false, duration: Math.round(performance.now() - start) });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  // Non-interactive: --all
  if (args.includes("--all")) {
    return runSelected(suites.map((s) => s.value));
  }

  // Non-interactive: pass suite numbers (e.g. "01 03 07")
  if (args.length > 0 && !args[0].startsWith("-")) {
    const selected = args
      .map((arg) => suites.find((s) => s.value.startsWith(arg.padStart(2, "0"))))
      .filter(Boolean)
      .map((s) => s!.value);
    if (selected.length > 0) return runSelected(selected);
  }

  // Interactive mode
  p.intro(pc.bold(pc.cyan("kitn API Test Runner")));

  const result = await p.multiselect({
    message: "Which test suites would you like to run?",
    options: suites.map((s) => ({
      value: s.value,
      label: s.label,
      hint: s.hint,
    })),
    required: true,
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return runSelected(result as string[]);
}

async function runSelected(selected: string[]) {
  console.log();
  console.log(pc.bold(`Running ${selected.length} test suite${selected.length > 1 ? "s" : ""}...`));

  const results: { name: string; ok: boolean; duration: number }[] = [];

  for (const name of selected) {
    const { ok, duration } = await runScript(name);
    results.push({ name, ok, duration });
  }

  // Final summary
  console.log();
  console.log(pc.bold(pc.cyan("=== Summary ===")));
  console.log();

  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  for (const r of results) {
    const status = r.ok ? pc.green("PASS") : pc.red("FAIL");
    const label = suites.find((s) => s.value === r.name)?.label ?? r.name;
    console.log(`  ${status}  ${label}  ${pc.dim(`${r.duration}ms`)}`);
  }

  console.log();
  if (failed.length === 0) {
    console.log(pc.green(pc.bold(`All ${passed.length} suites passed.`)));
  } else {
    console.log(
      pc.bold(`${pc.green(`${passed.length} passed`)}, ${pc.red(`${failed.length} failed`)}`) +
        pc.dim(` (${results.length} total)`),
    );
  }
  console.log();

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
