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

program
  .command("add")
  .description("Add components from the kitn registry")
  .argument("[components...]", "component names to install")
  .option("-o, --overwrite", "overwrite existing files without prompting")
  .option("-t, --type <type>", "filter by component type")
  .action(async (components: string[], opts) => {
    const { addCommand } = await import("./commands/add.js");
    await addCommand(components, opts);
  });

program.parse();
