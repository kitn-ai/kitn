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
  .option("-t, --type <type>", "filter by type (agent, tool, skill, storage, package)")
  .option("-r, --registry <namespace>", "only show components from this registry")
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

program
  .command("info")
  .description("Show details about a component")
  .argument("<component>", "component name (e.g. weather-agent, @acme/tool@1.0.0)")
  .action(async (component: string) => {
    const { infoCommand } = await import("./commands/info.js");
    await infoCommand(component);
  });

const registry = program
  .command("registry")
  .description("Manage component registries");

registry
  .command("add")
  .description("Add a component registry")
  .argument("<namespace>", "registry namespace (e.g. @myteam)")
  .argument("<url>", "URL template with {type} and {name} placeholders")
  .option("-o, --overwrite", "overwrite if namespace already exists")
  .action(async (namespace: string, url: string, opts) => {
    const { registryAddCommand } = await import("./commands/registry.js");
    await registryAddCommand(namespace, url, opts);
  });

registry
  .command("remove")
  .description("Remove a component registry")
  .argument("<namespace>", "registry namespace to remove (e.g. @myteam)")
  .option("-f, --force", "allow removing the default @kitn registry")
  .action(async (namespace: string, opts) => {
    const { registryRemoveCommand } = await import("./commands/registry.js");
    await registryRemoveCommand(namespace, opts);
  });

registry
  .command("list")
  .description("List all configured registries")
  .action(async () => {
    const { registryListCommand } = await import("./commands/registry.js");
    await registryListCommand();
  });

program.parse();
