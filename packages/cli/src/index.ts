import { Command } from "commander";
import { startUpdateCheck } from "./utils/update-check.js";

declare const __CLI_VERSION__: string;
const VERSION = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";

const printUpdateNotice = startUpdateCheck(VERSION);

const program = new Command()
  .name("kitn")
  .description("Install AI agent components from the kitn registry")
  .version(VERSION);

program
  .command("init")
  .description("Initialize kitn in your project")
  .option("-r, --runtime <runtime>", "runtime to use (bun, node, deno)")
  .option("-f, --framework <framework>", "HTTP framework (hono, hono-openapi, elysia)")
  .option("-b, --base <path>", "base directory for components (default: src/ai)")
  .option("-y, --yes", "accept all defaults without prompting")
  .action(async (opts) => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand(opts);
  });

program
  .command("add")
  .alias("install")
  .description("Add components from the registry (supports type-first: kitn add agent <name>)")
  .argument("[components...]", "component names or type followed by names")
  .option("-o, --overwrite", "overwrite existing files without prompting")
  .option("-t, --type <type>", "filter by component type during resolution")
  .action(async (components: string[], opts) => {
    const { addCommand } = await import("./commands/add.js");
    await addCommand(components, opts);
  });

program
  .command("list")
  .argument("[type]", "filter by type (agents, tools, skills, storages, packages)")
  .description("List available and installed components")
  .option("-i, --installed", "only show installed components")
  .option("-t, --type <type>", "filter by type (agent, tool, skill, storage, package)")
  .option("-r, --registry <namespace>", "only show components from this registry")
  .option("-v, --verbose", "show version numbers")
  .action(async (type, opts) => {
    const { listCommand } = await import("./commands/list.js");
    await listCommand(type, opts);
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
  .alias("uninstall")
  .description("Remove an installed component")
  .argument("[component]", "component name to remove (interactive if omitted)")
  .action(async (component?: string) => {
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
  .command("create")
  .description("Scaffold a new kitn component")
  .argument("<type>", "component type (agent, tool, skill, storage)")
  .argument("<name>", "component name")
  .action(async (type: string, name: string) => {
    const { createCommand } = await import("./commands/create.js");
    await createCommand(type, name);
  });

program
  .command("info")
  .description("Show details about a component")
  .argument("<component>", "component name (e.g. weather-agent, @acme/tool@1.0.0)")
  .action(async (component: string) => {
    const { infoCommand } = await import("./commands/info.js");
    await infoCommand(component);
  });

program
  .command("check")
  .description("Check for CLI updates")
  .action(async () => {
    const { checkCommand } = await import("./commands/check.js");
    await checkCommand(VERSION);
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
  .option("--homepage <url>", "registry homepage URL")
  .option("--description <text>", "short description of the registry")
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

await program.parseAsync();
// Skip the deferred update notice if `kitn check` already handled it
const ranCommand = program.args[0];
if (ranCommand !== "check") {
  printUpdateNotice();
}
