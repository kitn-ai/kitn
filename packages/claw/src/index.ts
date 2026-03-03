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

await program.parseAsync();
