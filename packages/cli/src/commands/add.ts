import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  addComponents,
  writeConflictFile,
  fetchAllIndexItems,
  findDisambiguationCandidates,
  parseTypeFilter,
  readConfig,
  readLock,
  resolveRoutesAlias,
  parseComponentRef,
  toComponentType,
  resolveTypeAlias,
  type IndexItem,
  type ComponentType,
} from "@kitnai/cli-core";
import { detectPackageManager } from "../utils/detect.js";
import { installDependencies, installDevDependencies } from "../installers/dep-installer.js";
import { collectEnvVars, handleEnvVars } from "../installers/env-writer.js";
import { requireConfig } from "../utils/auto-init.js";

interface AddOptions {
  overwrite?: boolean;
  type?: string;
  yes?: boolean;
}

export async function addCommand(components: string[], opts: AddOptions) {
  p.intro(pc.bgCyan(pc.black(" kitn add ")));

  let cwd = process.cwd();
  let config;
  ({ config, cwd } = await requireConfig(cwd));

  const lock = await readLock(cwd);

  // --- Interactive browse mode ---
  if (components.length === 0) {
    const allItems = await fetchAllIndexItems(config.registries);

    if (allItems.length === 0) {
      p.log.warn("No components found in configured registries.");
      process.exit(0);
    }

    const installed = new Set(Object.keys(lock));

    const typeLabels: Record<string, string> = {
      "kitn:agent": "Agents",
      "kitn:tool": "Tools",
      "kitn:skill": "Skills",
      "kitn:storage": "Storage",
      "kitn:package": "Packages",
    };

    const groups = new Map<string, typeof allItems>();
    for (const item of allItems) {
      if (!groups.has(item.type)) groups.set(item.type, []);
      groups.get(item.type)!.push(item);
    }

    const options: Array<{ value: string; label: string; hint?: string }> = [];
    for (const [type, items] of groups) {
      const label = typeLabels[type] ?? type;
      options.push({ value: `__separator_${type}`, label: pc.bold(`── ${label} ${"─".repeat(Math.max(0, 40 - label.length))}`), hint: "" });
      for (const item of items) {
        const isInstalled = installed.has(item.name);
        options.push({
          value: item.name,
          label: isInstalled ? pc.dim(`${item.name} (installed)`) : item.name,
          hint: item.description,
        });
      }
    }

    const selected = await p.multiselect({
      message: "Select components to install:",
      options,
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    components = (selected as string[]).filter((s) => !s.startsWith("__separator_"));

    if (components.length === 0) {
      p.log.warn("No components selected.");
      process.exit(0);
    }
  }

  // --- Type filter parsing ---
  const { typeFilter, components: filteredComponents, error: typeError } = parseTypeFilter(
    components,
    opts.type,
  );
  if (typeError) {
    p.log.error(typeError);
    process.exit(1);
  }
  components = filteredComponents;

  // --- Resolve "routes" alias ---
  const resolvedComponents = components.map((c) => {
    if (c === "routes") return resolveRoutesAlias(config);
    return c;
  });

  // --- Disambiguation ---
  const s = p.spinner();
  s.start("Resolving dependencies...");

  const allIndexItems = await fetchAllIndexItems(config.registries);
  const refs = resolvedComponents.map(parseComponentRef);
  const candidates = findDisambiguationCandidates(resolvedComponents, allIndexItems, refs, typeFilter);

  // Handle disambiguation interactively
  const preResolvedComponents: string[] = [];
  const preResolvedTypeMap: Record<string, string> = {};

  for (const candidate of candidates) {
    if (!candidate.needsDisambiguation) {
      if (candidate.resolved) {
        preResolvedComponents.push(candidate.resolved.name);
        preResolvedTypeMap[candidate.resolved.name] = candidate.resolved.type;
      } else {
        preResolvedComponents.push(candidate.input);
      }
      continue;
    }

    // Need interactive disambiguation
    const matches = candidate.exactMatches.length > 0
      ? candidate.exactMatches
      : candidate.fuzzyMatches;

    if (matches.length === 0) {
      preResolvedComponents.push(candidate.input);
      continue;
    }

    // Multiple matches -- determine if it's fuzzy (not found) or type ambiguity
    const uniqueNames = [...new Set(matches.map((m) => m.name))];
    const uniqueTypes = [...new Set(matches.map((m) => m.type))];

    if (candidate.exactMatches.length > 0 && uniqueTypes.length > 1) {
      // Same name, multiple types
      s.stop("Disambiguation needed");

      if (!process.stdin.isTTY) {
        const typeNames = uniqueTypes.map((t) => t.replace("kitn:", "")).join(", ");
        p.log.error(
          `Multiple components named ${pc.bold(candidate.input)} found (${typeNames}). Specify the type: ${pc.cyan(`kitn add ${uniqueTypes[0].replace("kitn:", "")} ${candidate.input}`)}`
        );
        process.exit(1);
      }

      const selected = await p.multiselect({
        message: `Multiple types found for ${pc.bold(candidate.input)}. Which do you want to install?`,
        options: uniqueTypes.map((t) => ({
          value: t,
          label: `${candidate.input} ${pc.dim(`(${t.replace("kitn:", "")})`)}`,
        })),
      });

      if (p.isCancel(selected)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      for (const type of selected as string[]) {
        preResolvedComponents.push(candidate.input);
        preResolvedTypeMap[candidate.input] = type;
      }

      s.start("Resolving dependencies...");
    } else {
      // Fuzzy matches -- multiple names
      s.stop("Multiple matches found");

      if (!process.stdin.isTTY) {
        const suggestions = matches.map((m) => `${m.name} (${m.type.replace("kitn:", "")})`).join(", ");
        p.log.error(
          `Component ${pc.bold(candidate.input)} not found. Did you mean one of: ${suggestions}`
        );
        process.exit(1);
      }

      const selected = await p.multiselect({
        message: `No exact match for ${pc.bold(candidate.input)}. Select component(s) to install:`,
        options: matches.map((m) => ({
          value: `${m.name}::${m.type}`,
          label: `${m.name} ${pc.dim(`(${m.type.replace("kitn:", "")})`)}`,
        })),
      });

      if (p.isCancel(selected)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      for (const sel of selected as string[]) {
        const [selName, selType] = sel.split("::");
        preResolvedComponents.push(selName);
        preResolvedTypeMap[selName] = selType;
      }

      s.start("Resolving dependencies...");
    }
  }

  s.stop("Dependencies resolved");

  // --- Slot conflict detection (pre-check for prompting) ---
  // We need to detect and prompt for slot conflicts before calling addComponents
  // For this, we need to run dependency resolution first -- but addComponents does that internally.
  // Instead, we'll call addComponents with slot decisions.

  // For simplicity, we'll do a two-pass approach:
  // 1. Call addComponents, which returns slot conflicts
  // 2. If there are slot conflicts and we're interactive, prompt and recall
  // Actually, we pass slotDecisions to addComponents.
  // But we don't know the conflicts yet... so we call addComponents without decisions first.

  // Build type filter string for addComponents
  const effectiveTypeFilter = typeFilter
    ? (typeFilter.startsWith("kitn:") ? typeFilter : undefined)
    : undefined;

  // First, try to detect slot conflicts manually
  // We need the resolved items, but addComponents does the resolution.
  // Let's just call addComponents and handle slot conflicts in a simple way.

  // Actually, let's use a simpler approach: pass overwrite and yes flags through,
  // and handle slot conflicts after the fact.

  // For the initial call, if not interactive, just overwrite slot conflicts
  let slotDecisions: Record<string, "replace" | "add"> | undefined;

  // We'll call addComponents. If it returns slot conflicts, we prompt and re-call.
  // But that would redo all the work. Instead, let's be pragmatic:
  // The task description says to detect conflicts and return them.
  // The CLI can prompt, then call again with decisions.

  // For efficiency, let's just call addComponents with no slot decisions.
  // If there are conflicts and we're interactive, prompt and then recall.
  // If --overwrite or --yes, auto-replace.

  try {
    const result = await addComponents({
      components: preResolvedComponents,
      cwd,
      overwrite: opts.overwrite,
      typeFilter,
    });

    // Handle slot conflicts if any (need interactive prompting)
    if (result.slotConflicts.length > 0) {
      slotDecisions = {};
      for (const conflict of result.slotConflicts) {
        if (opts.yes || opts.overwrite) {
          slotDecisions[conflict.existing] = "replace";
        } else {
          const action = await p.select({
            message: `${pc.bold(conflict.existing)} already fills the ${pc.cyan(conflict.slot)} slot. What would you like to do?`,
            options: [
              { value: "replace", label: `Replace ${conflict.existing} with ${conflict.incoming}` },
              { value: "add", label: `Add alongside ${conflict.existing}` },
            ],
          });

          if (p.isCancel(action)) {
            p.cancel("Cancelled.");
            process.exit(0);
          }

          slotDecisions[conflict.existing] = action as "replace" | "add";
        }
      }

      // Re-run with slot decisions
      const result2 = await addComponents({
        components: preResolvedComponents,
        cwd,
        overwrite: opts.overwrite,
        typeFilter,
        slotDecisions,
      });

      await handleAddResult(result2, opts, cwd);
      return;
    }

    await handleAddResult(result, opts, cwd);
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }
}

async function handleAddResult(
  result: Awaited<ReturnType<typeof addComponents>>,
  opts: AddOptions,
  cwd: string,
) {
  const s = p.spinner();

  // Display resolved components
  const expandedNames = new Set(result.installed.map((i) => i.name));
  p.log.info("Components to install:\n" + result.resolved.map((item) => {
    const isExplicit = expandedNames.has(item.name);
    const label = isExplicit ? item.name : `${item.name} ${pc.dim("(dependency)")}`;
    return `  ${pc.cyan(label)}`;
  }).join("\n"));

  // Display npm dependencies
  const totalDeps = result.npmDeps.length + result.npmDevDeps.length;
  if (totalDeps > 0) {
    const depLines = result.npmDeps.map((d) => `  ${pc.cyan(d)}`);
    const devDepLines = result.npmDevDeps.map((d) => `  ${pc.dim(d)}`);
    p.log.info("Dependencies:\n" + [...depLines, ...devDepLines].join("\n"));
  }

  // Confirmation prompt
  if (!opts.yes && process.stdin.isTTY) {
    const totalComponents = result.resolved.length;
    const summary = totalDeps > 0
      ? `Install ${totalComponents} component(s) and ${totalDeps} npm package(s)?`
      : `Install ${totalComponents} component(s)?`;
    const confirm = await p.confirm({ message: summary });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  // Handle file conflicts interactively
  if (result.fileConflicts.length > 0 && !opts.overwrite) {
    for (const conflict of result.fileConflicts) {
      p.log.message(pc.dim(conflict.diff));

      const action = await p.select({
        message: `${conflict.path} already exists and differs. What to do?`,
        options: [
          { value: "skip", label: "Keep local version" },
          { value: "overwrite", label: "Overwrite with registry version" },
        ],
      });

      if (!p.isCancel(action) && action === "overwrite") {
        await writeConflictFile(conflict.path, conflict.newContent, cwd);
      }
    }
  }

  // Install npm dependencies
  if (totalDeps > 0) {
    const pm = await detectPackageManager(cwd);
    if (pm) {
      s.start(`Installing ${totalDeps} npm dependenc${totalDeps === 1 ? "y" : "ies"}...`);
      try {
        if (result.npmDeps.length > 0) installDependencies(pm, result.npmDeps, cwd);
        if (result.npmDevDeps.length > 0) installDevDependencies(pm, result.npmDevDeps, cwd);
        s.stop("Dependencies installed");
      } catch {
        s.stop(pc.yellow("Some dependencies failed to install"));
      }
    }
  }

  // Display results
  if (result.created.length > 0) {
    p.log.success(`Added ${result.created.length} file(s):\n` + result.created.map((f) => `  ${pc.green("+")} ${f}`).join("\n"));
  }
  if (result.updated.length > 0) {
    p.log.success(`Updated ${result.updated.length} file(s):\n` + result.updated.map((f) => `  ${pc.yellow("~")} ${f}`).join("\n"));
  }
  if (result.skipped.length > 0) {
    p.log.info(`Skipped ${result.skipped.length} file(s):\n` + result.skipped.map((f) => `  ${pc.dim("-")} ${f}`).join("\n"));
  }

  if (result.barrelUpdated) {
    const config = await readConfig(cwd);
    const baseDir = config?.aliases.base ?? "src/ai";
    p.log.info(`Updated barrel file: ${baseDir}/index.ts`);

    if (result.barrelIsNew) {
      p.note(
        [
          `import { ai } from "@kitn/plugin";`,
          ``,
          `app.route("/api", ai.router);`,
        ].join("\n"),
        "Add this to your server entry point",
      );
    }
  }

  // Handle environment variables
  if (Object.keys(result.envVars).length > 0) {
    await handleEnvVars(cwd, result.envVars);
  }

  // Show docs hints
  for (const item of result.resolved) {
    if (item.docs) {
      p.log.info(`${pc.bold(item.name)}: ${item.docs}`);
    }
  }

  // Show next-step hints
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      p.log.warn(`${pc.bold(err.component)}: ${err.error}`);
    }
  }

  // Show next-step hints for well-known packages
  const config = await readConfig(cwd);
  if (config) {
    const resolvedNames = new Set(result.resolved.map((r) => r.name));
    const lock = await readLock(cwd);
    const projectInstalled = new Set(Object.keys(lock));
    const hints: string[] = [];

    const adapterName = resolveRoutesAlias(config);
    if (resolvedNames.has("core") && !resolvedNames.has(adapterName) && !projectInstalled.has(adapterName)) {
      hints.push(`Run ${pc.cyan(`kitn add routes`)} to install the HTTP adapter.`);
    }

    if (hints.length > 0) {
      p.log.message(pc.bold("\nNext steps:") + "\n" + hints.join("\n"));
    }
  }

  p.outro(pc.green("Done!"));
}
