import { Command } from "commander";

const program = new Command()
  .name("kitn")
  .description("Install AI agent components from the kitn registry")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize kitn in your project")
  .action(async () => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand();
  });

program.parse();
