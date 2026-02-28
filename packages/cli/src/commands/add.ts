import * as p from "@clack/prompts";
import pc from "picocolors";
import { join, dirname } from "path";
import { readConfig, writeConfig, getInstallPath, resolveRoutesAlias, readLock, writeLock } from "../utils/config.js";
import { detectPackageManager } from "../utils/detect.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { resolveDependencies } from "../registry/resolver.js";
import {
  checkFileStatus,
  writeComponentFile,
  readExistingFile,
  generateDiff,
  FileStatus,
} from "../installers/file-writer.js";
import { installDependencies, installDevDependencies } from "../installers/dep-installer.js";
import { collectEnvVars, handleEnvVars } from "../installers/env-writer.js";
import { rewriteKitnImports } from "../installers/import-rewriter.js";
import { createBarrelFile, addImportToBarrel, removeImportFromBarrel } from "../installers/barrel-manager.js";
import { contentHash } from "../utils/hash.js";
import { parseComponentRef, type ComponentRef } from "../utils/parse-ref.js";
import { resolveTypeAlias, toComponentType } from "../utils/type-aliases.js";
import { typeToDir, type RegistryItem, type ComponentType } from "../registry/schema.js";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { relative } from "path";

interface AddOptions {
  overwrite?: boolean;
  type?: string;
}

export async function addCommand(components: string[], opts: AddOptions) {
  p.intro(pc.bgCyan(pc.black(" kitn add ")));

  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  const lock = await readLock(cwd);

  if (components.length === 0) {
    // Interactive browse mode — fetch index, group by type, multi-select
    const fetcher = new RegistryFetcher(config.registries);
    const s = p.spinner();
    s.start("Fetching registry...");

    const allItems: Array<{ name: string; type: string; description: string; namespace: string }> = [];
    for (const namespace of Object.keys(config.registries)) {
      try {
        const index = await fetcher.fetchIndex(namespace);
        for (const item of index.items) {
          allItems.push({ name: item.name, type: item.type, description: item.description, namespace });
        }
      } catch {
        // Skip failing registries
      }
    }

    s.stop(`Found ${allItems.length} component(s)`);

    if (allItems.length === 0) {
      p.log.warn("No components found in configured registries.");
      process.exit(0);
    }

    const installed = new Set(Object.keys(lock));

    // Group by type, preserving order
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

  // --- Positional type argument parsing ---
  // e.g. `kitn add agent weather` → typeFilter="agent", components=["weather"]
  let typeFilter: string | undefined;
  const firstAlias = resolveTypeAlias(components[0]);
  if (firstAlias) {
    if (components.length === 1) {
      p.log.error(
        `${pc.bold(components[0])} looks like a type, not a component name. Usage: ${pc.cyan(`kitn add ${components[0]} <name>`)}`
      );
      process.exit(1);
    }
    typeFilter = firstAlias;
    components = components.slice(1);
  }

  // Merge with --type flag (flag wins on conflict)
  if (opts.type) {
    const flagAlias = resolveTypeAlias(opts.type);
    if (!flagAlias) {
      p.log.error(`Unknown type ${pc.bold(opts.type)}. Valid types: agent, tool, skill, storage, package`);
      process.exit(1);
    }
    if (typeFilter && typeFilter !== flagAlias) {
      p.log.warn(`Positional type ${pc.bold(typeFilter)} overridden by --type ${pc.bold(flagAlias)}`);
    }
    typeFilter = flagAlias;
  }

  // Resolve "routes" to framework-specific adapter name, then parse refs
  const resolvedComponents = components.map((c) => {
    if (c === "routes") {
      return resolveRoutesAlias(config);
    }
    return c;
  });

  const refs = resolvedComponents.map(parseComponentRef);
  const fetcher = new RegistryFetcher(config.registries);

  // --- Disambiguation: resolve ambiguous names before dependency resolution ---
  const s = p.spinner();
  s.start("Resolving dependencies...");

  // Build a map of pre-resolved types for explicitly requested components
  const preResolvedTypes = new Map<string, ComponentType>();
  let expandedNames = [...resolvedComponents];

  try {
    // Fetch all registry indices
    const namespacesToFetch = Object.keys(config.registries);
    const allIndexItems: Array<{ name: string; type: ComponentType; namespace: string }> = [];

    for (const namespace of namespacesToFetch) {
      try {
        const index = await fetcher.fetchIndex(namespace);
        for (const item of index.items) {
          allIndexItems.push({ name: item.name, type: item.type, namespace });
        }
      } catch {
        // Skip failing registries during disambiguation
      }
    }

    // Check each explicit component for ambiguity
    const newExpandedNames: string[] = [];
    for (const name of resolvedComponents) {
      const ref = refs.find((r) => r.name === name) ?? { namespace: "@kitn", name, version: undefined };
      let matches = allIndexItems.filter((i) => i.name === name && (ref.namespace === "@kitn" || i.namespace === ref.namespace));

      if (typeFilter) {
        const filteredType = toComponentType(typeFilter);
        matches = matches.filter((m) => m.type === filteredType);
      }

      if (matches.length === 0) {
        // No exact match — try substring search
        let fuzzyMatches = allIndexItems.filter(
          (i) => i.name.includes(name) && (ref.namespace === "@kitn" || i.namespace === ref.namespace)
        );

        if (typeFilter) {
          const filteredType = toComponentType(typeFilter);
          fuzzyMatches = fuzzyMatches.filter((m) => m.type === filteredType);
        }

        if (fuzzyMatches.length === 0) {
          // Truly not found — let the resolution phase produce the error
          newExpandedNames.push(name);
        } else if (fuzzyMatches.length === 1) {
          // Single substring match — use it directly
          preResolvedTypes.set(fuzzyMatches[0].name, fuzzyMatches[0].type);
          newExpandedNames.push(fuzzyMatches[0].name);
        } else {
          // Multiple substring matches — prompt user to select
          s.stop("Multiple matches found");

          if (!process.stdin.isTTY) {
            const suggestions = fuzzyMatches.map((m) => `${m.name} (${m.type.replace("kitn:", "")})`).join(", ");
            p.log.error(
              `Component ${pc.bold(name)} not found. Did you mean one of: ${suggestions}`
            );
            process.exit(1);
          }

          const selected = await p.multiselect({
            message: `No exact match for ${pc.bold(name)}. Select component(s) to install:`,
            options: fuzzyMatches.map((m) => ({
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
            preResolvedTypes.set(selName, selType as ComponentType);
            newExpandedNames.push(selName);
          }

          s.start("Resolving dependencies...");
        }
      } else if (matches.length === 1) {
        preResolvedTypes.set(name, matches[0].type);
        newExpandedNames.push(name);
      } else {
        // Multiple types for the same name
        const uniqueTypes = [...new Set(matches.map((m) => m.type))];
        if (uniqueTypes.length === 1) {
          preResolvedTypes.set(name, uniqueTypes[0]);
          newExpandedNames.push(name);
        } else {
          // Need disambiguation
          s.stop("Disambiguation needed");

          if (!process.stdin.isTTY) {
            const typeNames = uniqueTypes.map((t) => t.replace("kitn:", "")).join(", ");
            p.log.error(
              `Multiple components named ${pc.bold(name)} found (${typeNames}). Specify the type: ${pc.cyan(`kitn add ${uniqueTypes[0].replace("kitn:", "")} ${name}`)}`
            );
            process.exit(1);
          }

          const selected = await p.multiselect({
            message: `Multiple types found for ${pc.bold(name)}. Which do you want to install?`,
            options: uniqueTypes.map((t) => ({
              value: t,
              label: `${name} ${pc.dim(`(${t.replace("kitn:", "")})`)}`,
            })),
          });

          if (p.isCancel(selected)) {
            p.cancel("Cancelled.");
            process.exit(0);
          }

          for (const type of selected as ComponentType[]) {
            preResolvedTypes.set(name, type);
            newExpandedNames.push(name);
          }

          s.start("Resolving dependencies...");
        }
      }
    }
    expandedNames = newExpandedNames;
  } catch (err: any) {
    s.stop(pc.red("Failed to resolve dependencies"));
    p.log.error(err.message);
    process.exit(1);
  }

  // --- Dependency resolution with type-aware fetching ---
  let resolved: RegistryItem[];
  try {
    resolved = await resolveDependencies(expandedNames, async (name) => {
      const ref = refs.find((r) => r.name === name) ?? { namespace: "@kitn", name, version: undefined };
      const index = await fetcher.fetchIndex(ref.namespace);

      // Use pre-resolved type for explicit names, first-match for transitive deps
      const preResolved = preResolvedTypes.get(name);
      const indexItem = preResolved
        ? index.items.find((i) => i.name === name && i.type === preResolved)
        : index.items.find((i) => i.name === name);

      if (!indexItem) throw new Error(`Component '${name}' not found in ${ref.namespace} registry`);
      const dir = typeToDir[indexItem.type];
      return fetcher.fetchItem(name, dir as any, ref.namespace, ref.version);
    });
  } catch (err: any) {
    s.stop(pc.red("Failed to resolve dependencies"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop(`Resolved ${resolved.length} component(s)`);

  // --- Slot conflict detection ---
  const slotReplacements = new Map<string, string>(); // oldName → newName
  for (const item of resolved) {
    if (!item.slot) continue;
    const existing = Object.entries(lock).find(
      ([key, entry]) => key !== item.name && entry.slot === item.slot
    );
    if (!existing) continue;

    const [existingKey] = existing;
    const action = await p.select({
      message: `${pc.bold(existingKey)} already fills the ${pc.cyan(item.slot)} slot. What would you like to do?`,
      options: [
        { value: "replace", label: `Replace ${existingKey} with ${item.name}` },
        { value: "add", label: `Add alongside ${existingKey}` },
      ],
    });

    if (p.isCancel(action)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    if (action === "replace") {
      slotReplacements.set(existingKey, item.name);
    }
  }

  // Process slot replacements — remove old components
  if (slotReplacements.size > 0) {
    const baseDir = config.aliases.base ?? "src/ai";
    for (const [oldKey] of slotReplacements) {
      const oldEntry = lock[oldKey];
      if (!oldEntry) continue;

      for (const filePath of oldEntry.files) {
        try {
          await unlink(join(cwd, filePath));
        } catch {
          // File may have been moved or deleted
        }
      }

      // Remove barrel imports for deleted files
      const barrelPath = join(cwd, baseDir, "index.ts");
      const barrelEligibleDirs = new Set([
        config.aliases.agents,
        config.aliases.tools,
        config.aliases.skills,
      ]);

      if (existsSync(barrelPath)) {
        let barrelContent = await readFile(barrelPath, "utf-8");
        let barrelChanged = false;

        for (const filePath of oldEntry.files) {
          const fileDir = dirname(filePath);
          if (!barrelEligibleDirs.has(fileDir)) continue;
          const barrelDir = join(cwd, baseDir);
          const importPath = "./" + relative(barrelDir, join(cwd, filePath)).replace(/\\/g, "/");
          const updated = removeImportFromBarrel(barrelContent, importPath);
          if (updated !== barrelContent) {
            barrelContent = updated;
            barrelChanged = true;
          }
        }

        if (barrelChanged) {
          await writeFile(barrelPath, barrelContent);
        }
      }

      delete lock[oldKey];
      p.log.info(`Replaced ${pc.dim(oldKey)} → ${pc.cyan(slotReplacements.get(oldKey)!)}`);
    }
  }

  p.log.info("Components to install:\n" + resolved.map((item) => {
    const isExplicit = expandedNames.includes(item.name) || components.includes(item.name);
    const label = isExplicit ? item.name : `${item.name} ${pc.dim("(dependency)")}`;
    return `  ${pc.cyan(label)}`;
  }).join("\n"));

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const allDeps: string[] = [];
  const allDevDeps: string[] = [];
  for (const item of resolved) {
    if (item.dependencies) allDeps.push(...item.dependencies);
    if (item.devDependencies) allDevDeps.push(...item.devDependencies);

    // Skip file processing for packages already installed with identical content
    const existingInstall = lock[item.name];
    if (existingInstall && item.type === "kitn:package") {
      const allContent = item.files.map((f) => f.content).join("\n");
      if (contentHash(allContent) === existingInstall.hash) {
        continue;
      }
    }

    if (item.type === "kitn:package") {
      // Package install — multi-file, preserved directory structure
      const baseDir = config.aliases.base ?? "src/ai";

      for (const file of item.files) {
        const targetPath = join(cwd, baseDir, file.path);
        const relativePath = join(baseDir, file.path);

        const status = await checkFileStatus(targetPath, file.content);

        switch (status) {
          case FileStatus.New:
            await writeComponentFile(targetPath, file.content);
            created.push(relativePath);
            break;

          case FileStatus.Identical:
            skipped.push(relativePath);
            break;

          case FileStatus.Different:
            if (opts.overwrite) {
              await writeComponentFile(targetPath, file.content);
              updated.push(relativePath);
            } else {
              const existing = await readExistingFile(targetPath);
              const diff = generateDiff(relativePath, existing ?? "", file.content);
              p.log.message(pc.dim(diff));

              const action = await p.select({
                message: `${relativePath} already exists and differs. What to do?`,
                options: [
                  { value: "skip", label: "Keep local version" },
                  { value: "overwrite", label: "Overwrite with registry version" },
                ],
              });

              if (!p.isCancel(action) && action === "overwrite") {
                await writeComponentFile(targetPath, file.content);
                updated.push(relativePath);
              } else {
                skipped.push(relativePath);
              }
            }
            break;
        }
      }

      // Track in lock
      const allContent = item.files.map((f) => f.content).join("\n");
      const ref = refs.find((r) => r.name === item.name) ?? { namespace: "@kitn", name: item.name, version: undefined };
      const installedKey = ref.namespace === "@kitn" ? item.name : `${ref.namespace}/${item.name}`;
      lock[installedKey] = {
        registry: ref.namespace,
        type: item.type,
        ...(item.slot && { slot: item.slot }),
        version: item.version ?? "1.0.0",
        installedAt: new Date().toISOString(),
        files: item.files.map((f) => join(baseDir, f.path)),
        hash: contentHash(allContent),
        registryDependencies: item.registryDependencies,
      };

    } else {
      // Regular component install — single file, import rewriting
      const ref = refs.find((r) => r.name === item.name) ?? { namespace: "@kitn", name: item.name, version: undefined };
      const ns = ref.namespace;

      for (const file of item.files) {
        const aliasKey = (() => {
          switch (item.type) {
            case "kitn:agent": return "agents";
            case "kitn:tool": return "tools";
            case "kitn:skill": return "skills";
            case "kitn:storage": return "storage";
          }
        })() as "agents" | "tools" | "skills" | "storage";

        const fileName = file.path.split("/").pop()!;
        const installPath = getInstallPath(config, item.type as Exclude<ComponentType, "kitn:package">, fileName, ns);
        const targetPath = join(cwd, installPath);
        const relativePath = installPath;
        const content = rewriteKitnImports(file.content, item.type, fileName, config.aliases);

        const status = await checkFileStatus(targetPath, content);

        switch (status) {
          case FileStatus.New:
            await writeComponentFile(targetPath, content);
            created.push(relativePath);
            break;

          case FileStatus.Identical:
            skipped.push(relativePath);
            break;

          case FileStatus.Different:
            if (opts.overwrite) {
              await writeComponentFile(targetPath, content);
              updated.push(relativePath);
            } else {
              const existing = await readExistingFile(targetPath);
              const diff = generateDiff(relativePath, existing ?? "", content);
              p.log.message(pc.dim(diff));

              const action = await p.select({
                message: `${relativePath} already exists and differs. What to do?`,
                options: [
                  { value: "skip", label: "Keep local version" },
                  { value: "overwrite", label: "Overwrite with registry version" },
                ],
              });

              if (!p.isCancel(action) && action === "overwrite") {
                await writeComponentFile(targetPath, content);
                updated.push(relativePath);
              } else {
                skipped.push(relativePath);
              }
            }
            break;
        }
      }

      // Track in lock
      const allContent = item.files.map((f) => {
        const fn = f.path.split("/").pop()!;
        return rewriteKitnImports(f.content, item.type, fn, config.aliases);
      }).join("\n");
      const installedKey = ns === "@kitn" ? item.name : `${ns}/${item.name}`;
      lock[installedKey] = {
        registry: ns,
        type: item.type,
        ...(item.slot && { slot: item.slot }),
        version: item.version ?? "1.0.0",
        installedAt: new Date().toISOString(),
        files: item.files.map((f) => {
          const fileName = f.path.split("/").pop()!;
          return getInstallPath(config, item.type as Exclude<ComponentType, "kitn:package">, fileName, ns);
        }),
        hash: contentHash(allContent),
        registryDependencies: item.registryDependencies,
      };
    }
  }

  // Barrel management — auto-wire imports for barrel-eligible components
  const BARREL_ELIGIBLE: Set<string> = new Set(["kitn:agent", "kitn:tool", "kitn:skill"]);
  const baseDir = config.aliases.base ?? "src/ai";
  const barrelPath = join(cwd, baseDir, "index.ts");
  const barrelDir = join(cwd, baseDir);

  const barrelImports: string[] = [];
  for (const item of resolved) {
    if (!BARREL_ELIGIBLE.has(item.type)) continue;

    const ref = refs.find((r) => r.name === item.name) ?? { namespace: "@kitn", name: item.name, version: undefined };

    for (const file of item.files) {
      const fileName = file.path.split("/").pop()!;
      const installPath = getInstallPath(config, item.type as Exclude<ComponentType, "kitn:package">, fileName, ref.namespace);
      const filePath = join(cwd, installPath);
      const importPath = "./" + relative(barrelDir, filePath).replace(/\\/g, "/");
      barrelImports.push(importPath);
    }
  }

  if (barrelImports.length > 0) {
    const barrelExisted = existsSync(barrelPath);
    let barrelContent: string;

    if (barrelExisted) {
      barrelContent = await readFile(barrelPath, "utf-8");
    } else {
      await mkdir(barrelDir, { recursive: true });
      barrelContent = createBarrelFile();
    }

    for (const importPath of barrelImports) {
      barrelContent = addImportToBarrel(barrelContent, importPath);
    }

    await writeFile(barrelPath, barrelContent);
    p.log.info(`Updated barrel file: ${join(baseDir, "index.ts")}`);

    if (!barrelExisted) {
      p.note(
        [
          `import { ai } from "./${baseDir.replace(/^src\//, "")}/plugin";`,
          ``,
          `app.route("/api", ai.router);`,
        ].join("\n"),
        "Add this to your server entry point",
      );
    }
  }

  await writeConfig(cwd, config);
  await writeLock(cwd, lock);

  const uniqueDeps = [...new Set(allDeps)];
  const uniqueDevDeps = [...new Set(allDevDeps)].filter((d) => !uniqueDeps.includes(d));
  const totalDeps = uniqueDeps.length + uniqueDevDeps.length;
  if (totalDeps > 0) {
    const pm = await detectPackageManager(cwd);
    if (pm) {
      s.start(`Installing ${totalDeps} npm dependenc${totalDeps === 1 ? "y" : "ies"}...`);
      try {
        if (uniqueDeps.length > 0) installDependencies(pm, uniqueDeps, cwd);
        if (uniqueDevDeps.length > 0) installDevDependencies(pm, uniqueDevDeps, cwd);
        s.stop("Dependencies installed");
      } catch {
        s.stop(pc.yellow("Some dependencies failed to install"));
      }
    }
  }

  if (created.length > 0) {
    p.log.success(`Added ${created.length} file(s):\n` + created.map((f) => `  ${pc.green("+")} ${f}`).join("\n"));
  }
  if (updated.length > 0) {
    p.log.success(`Updated ${updated.length} file(s):\n` + updated.map((f) => `  ${pc.yellow("~")} ${f}`).join("\n"));
  }
  if (skipped.length > 0) {
    p.log.info(`Skipped ${skipped.length} file(s):\n` + skipped.map((f) => `  ${pc.dim("-")} ${f}`).join("\n"));
  }

  // Handle environment variables
  const allEnvVars = collectEnvVars(resolved);
  await handleEnvVars(cwd, allEnvVars);

  for (const item of resolved) {
    if (item.docs) {
      p.log.info(`${pc.bold(item.name)}: ${item.docs}`);
    }
  }

  // Show next-step hints for well-known packages
  const resolvedNames = new Set(resolved.map((r) => r.name));
  const projectInstalled = new Set(Object.keys(lock));
  const hints: string[] = [];

  const adapterName = resolveRoutesAlias(config);

  // Only suggest adding routes if neither resolved nor already installed
  if (resolvedNames.has("core") && !resolvedNames.has(adapterName) && !projectInstalled.has(adapterName)) {
    hints.push(`Run ${pc.cyan(`kitn add routes`)} to install the HTTP adapter.`);
  }

  if (hints.length > 0) {
    p.log.message(pc.bold("\nNext steps:") + "\n" + hints.join("\n"));
  }

  p.outro(pc.green("Done!"));
}
