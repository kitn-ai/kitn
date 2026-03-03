import { Command } from "commander";
import { existsSync } from "fs";

const program = new Command()
  .name("kitnclaw")
  .description("KitnClaw — AI assistant powered by kitn")
  .version("0.1.0");

program
  .command("start", { isDefault: true })
  .description("Start the KitnClaw gateway")
  .action(async () => {
    // Auto-run setup on first launch if no config exists
    const { CONFIG_PATH } = await import("./config/io.js");
    if (!existsSync(CONFIG_PATH)) {
      console.log("Welcome to KitnClaw! Let's set up your AI provider.\n");
      const { setupWizard } = await import("./setup.js");
      await setupWizard();
      console.log(); // blank line before gateway output
    }

    const { startGateway } = await import("./gateway/start.js");
    await startGateway();
    // Keep the process alive
    await new Promise(() => {});
  });

program
  .command("setup")
  .description("Configure KitnClaw (provider, model, channels)")
  .action(async () => {
    const { setupWizard } = await import("./setup.js");
    await setupWizard();
  });

program
  .command("status")
  .description("Show KitnClaw configuration and status")
  .action(async () => {
    const { getStatus, formatStatus } = await import("./commands/status.js");
    const info = await getStatus();
    console.log(formatStatus(info));
  });

program
  .command("reset")
  .description("Clear sessions, memory, or workspace data")
  .option("--sessions", "Clear conversation sessions")
  .option("--memory", "Clear memory database")
  .option("--workspace", "Clear workspace tools/agents")
  .option("--all", "Clear everything")
  .action(async (opts: { sessions?: boolean; memory?: boolean; workspace?: boolean; all?: boolean }) => {
    const { resetData } = await import("./commands/reset.js");
    const targets: Array<"sessions" | "memory" | "workspace" | "all"> = [];
    if (opts.all) targets.push("all");
    else {
      if (opts.sessions) targets.push("sessions");
      if (opts.memory) targets.push("memory");
      if (opts.workspace) targets.push("workspace");
    }
    if (targets.length === 0) {
      console.log("Specify what to reset: --sessions, --memory, --workspace, or --all");
      return;
    }
    const results = await resetData(targets);
    for (const line of results) console.log(line);
  });

await program.parseAsync();
