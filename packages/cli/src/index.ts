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

program
  .command("list")
  .description("List available and installed components")
  .option("-i, --installed", "only show installed components")
  .option("-t, --type <type>", "filter by type (agent, tool, skill, storage)")
  .action(async (opts) => {
    const { listCommand } = await import("./commands/list.js");
    await listCommand(opts);
  });

program
  .command("diff")
  .description("Show differences between local and registry version")
  .argument("<component>", "component name")
  .action(async (component: string) => {
    const { diffCommand } = await import("./commands/diff.js");
    await diffCommand(component);
  });

program
  .command("remove")
  .description("Remove an installed component")
  .argument("<component>", "component name to remove")
  .action(async (component: string) => {
    const { removeCommand } = await import("./commands/remove.js");
    await removeCommand(component);
  });

program
  .command("update")
  .description("Update installed components to latest registry version")
  .argument("[components...]", "component names to update")
  .action(async (components: string[]) => {
    const { updateCommand } = await import("./commands/update.js");
    await updateCommand(components);
  });

program.parse();
