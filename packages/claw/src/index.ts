import { Command } from "commander";

const program = new Command()
  .name("kitnclaw")
  .description("KitnClaw — AI assistant powered by kitn")
  .version("0.1.0");

program
  .command("start")
  .description("Start the KitnClaw gateway")
  .action(async () => {
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

await program.parseAsync();
