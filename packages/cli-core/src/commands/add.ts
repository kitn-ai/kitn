import { join, dirname, relative } from "path";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { readConfig, readLock, writeLock, writeConfig } from "../config/io.js";
import { NotInitializedError } from "../errors.js";
import { getInstallPath, resolveRoutesAlias } from "../types/config.js";
import type { KitnConfig, LockFile } from "../types/config.js";
import { typeToDir } from "../types/registry.js";
import type { RegistryItem, ComponentType, RegistryIndex } from "../types/registry.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { resolveDependencies } from "../registry/resolver.js";
import { resolveTypeAlias, toComponentType } from "../utils/type-aliases.js";
import { parseComponentRef } from "../utils/parse-ref.js";
import type { ComponentRef } from "../utils/parse-ref.js";
import { contentHash } from "../utils/hash.js";
import { collectEnvVars } from "../utils/env.js";
import { rewriteKitnImports } from "../installers/import-rewriter.js";
import { createBarrelFile, addImportToBarrel, removeImportFromBarrel } from "../installers/barrel-manager.js";
import { checkFileStatus, writeComponentFile, readExistingFile } from "../installers/file-writer.js";
import { FileStatus, generateDiff } from "../installers/diff.js";
import type { EnvVarConfig } from "../types/registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddComponentsOpts {
  components: string[];
  cwd: string;
  overwrite?: boolean;
  typeFilter?: string;
  /** Pre-resolved slot replacement decisions: oldName -> "replace" | "add" */
  slotDecisions?: Record<string, "replace" | "add">;
}

export interface FileConflict {
  path: string;
  component: string;
  existingContent: string;
  newContent: string;
  diff: string;
}

export interface SlotConflict {
  existing: string;
  incoming: string;
  slot: string;
}

export interface InstalledComponent {
  name: string;
  files: string[];
  version: string;
}

export interface AddResult {
  installed: InstalledComponent[];
  slotConflicts: SlotConflict[];
  fileConflicts: FileConflict[];
  created: string[];
  updated: string[];
  skipped: string[];
  npmDeps: string[];
  npmDevDeps: string[];
  envVars: Record<string, EnvVarConfig>;
  errors: Array<{ component: string; error: string }>;
  resolved: RegistryItem[];
  barrelUpdated: boolean;
  barrelIsNew: boolean;
}

// ---------------------------------------------------------------------------
// Disambiguation: find candidates for ambiguous component names
// ---------------------------------------------------------------------------

export interface IndexItem {
  name: string;
  type: ComponentType;
  namespace: string;
  description: string;
}

export interface DisambiguationCandidate {
  /** Original user-typed name */
  input: string;
  /** Exact matches (name matches exactly) */
  exactMatches: IndexItem[];
  /** Fuzzy matches (name contains the input as substring) */
  fuzzyMatches: IndexItem[];
  /** Whether disambiguation is needed (multiple matches, user must pick) */
  needsDisambiguation: boolean;
  /** If exactly one match was found, this is it */
  resolved?: IndexItem;
}

/**
 * Parse type filter from positional args.
 * e.g. `kitn add agent weather` -> { typeFilter: "agent", remaining: ["weather"] }
 */
export function parseTypeFilter(
  components: string[],
  explicitType?: string,
): { typeFilter: string | undefined; components: string[]; error?: string } {
  let typeFilter: string | undefined;
  let remaining = [...components];

  const firstAlias = resolveTypeAlias(components[0]);
  if (firstAlias) {
    if (components.length === 1) {
      return {
        typeFilter: undefined,
        components,
        error: `"${components[0]}" looks like a type, not a component name. Usage: kitn add ${components[0]} <name>`,
      };
    }
    typeFilter = firstAlias;
    remaining = components.slice(1);
  }

  if (explicitType) {
    const flagAlias = resolveTypeAlias(explicitType);
    if (!flagAlias) {
      return {
        typeFilter: undefined,
        components: remaining,
        error: `Unknown type "${explicitType}". Valid types: agent, tool, skill, storage, package`,
      };
    }
    typeFilter = flagAlias;
  }

  return { typeFilter, components: remaining };
}

/**
 * Fetch all index items from all configured registries.
 */
export async function fetchAllIndexItems(
  registries: KitnConfig["registries"],
): Promise<IndexItem[]> {
  const fetcher = new RegistryFetcher(registries);
  const allItems: IndexItem[] = [];

  for (const namespace of Object.keys(registries)) {
    try {
      const index = await fetcher.fetchIndex(namespace);
      for (const item of index.items) {
        allItems.push({ name: item.name, type: item.type, namespace, description: item.description });
      }
    } catch {
      // Skip failing registries
    }
  }

  return allItems;
}

/**
 * Find disambiguation candidates for a list of component names.
 * Returns one entry per input name. When `resolved` is set, no user prompt is needed.
 */
export function findDisambiguationCandidates(
  names: string[],
  allIndexItems: IndexItem[],
  refs: ComponentRef[],
  typeFilter?: string,
): DisambiguationCandidate[] {
  const candidates: DisambiguationCandidate[] = [];

  for (const name of names) {
    const ref = refs.find((r) => r.name === name) ?? { namespace: "@kitn", name, version: undefined };
    let matches = allIndexItems.filter(
      (i) => i.name === name && (ref.namespace === "@kitn" || i.namespace === ref.namespace),
    );

    if (typeFilter) {
      const filteredType = toComponentType(typeFilter);
      matches = matches.filter((m) => m.type === filteredType);
    }

    if (matches.length === 0) {
      // No exact match -- try substring search
      let fuzzyMatches = allIndexItems.filter(
        (i) => i.name.includes(name) && (ref.namespace === "@kitn" || i.namespace === ref.namespace),
      );

      if (typeFilter) {
        const filteredType = toComponentType(typeFilter);
        fuzzyMatches = fuzzyMatches.filter((m) => m.type === filteredType);
      }

      if (fuzzyMatches.length === 0) {
        // Truly not found -- let resolution produce the error
        candidates.push({
          input: name,
          exactMatches: [],
          fuzzyMatches: [],
          needsDisambiguation: false,
          resolved: undefined,
        });
      } else if (fuzzyMatches.length === 1) {
        candidates.push({
          input: name,
          exactMatches: [],
          fuzzyMatches,
          needsDisambiguation: false,
          resolved: fuzzyMatches[0],
        });
      } else {
        candidates.push({
          input: name,
          exactMatches: [],
          fuzzyMatches,
          needsDisambiguation: true,
        });
      }
    } else if (matches.length === 1) {
      candidates.push({
        input: name,
        exactMatches: matches,
        fuzzyMatches: [],
        needsDisambiguation: false,
        resolved: matches[0],
      });
    } else {
      // Multiple matches for same name
      const uniqueTypes = [...new Set(matches.map((m) => m.type))];
      if (uniqueTypes.length === 1) {
        candidates.push({
          input: name,
          exactMatches: matches,
          fuzzyMatches: [],
          needsDisambiguation: false,
          resolved: matches[0],
        });
      } else {
        // Multiple types for the same name -- need disambiguation
        candidates.push({
          input: name,
          exactMatches: matches,
          fuzzyMatches: [],
          needsDisambiguation: true,
        });
      }
    }
  }

  return candidates;
}

/**
 * Detect slot conflicts between resolved items and the current lock file.
 */
export function detectSlotConflicts(
  resolved: RegistryItem[],
  lock: LockFile,
): SlotConflict[] {
  const conflicts: SlotConflict[] = [];
  for (const item of resolved) {
    if (!item.slot) continue;
    const existing = Object.entries(lock).find(
      ([key, entry]) => key !== item.name && entry.slot === item.slot,
    );
    if (!existing) continue;
    conflicts.push({
      existing: existing[0],
      incoming: item.name,
      slot: item.slot,
    });
  }
  return conflicts;
}

/**
 * Process slot replacements: remove old component files, barrel imports, and lock entries.
 */
async function processSlotReplacements(
  replacements: Map<string, string>,
  lock: LockFile,
  config: KitnConfig,
  cwd: string,
): Promise<void> {
  if (replacements.size === 0) return;

  const baseDir = config.aliases.base ?? "src/ai";
  for (const [oldKey] of replacements) {
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
  }
}

// ---------------------------------------------------------------------------
// Main: addComponents
// ---------------------------------------------------------------------------

/**
 * Install components from the registry into a kitn project.
 *
 * Pure logic -- no interactive prompts, no process.exit, no UI formatting.
 *
 * The caller (CLI or MCP) is responsible for:
 * - Interactive browse mode (when no components are given)
 * - Disambiguation prompts (use `findDisambiguationCandidates` for data)
 * - File conflict prompts (conflicts are returned in `fileConflicts`)
 * - Slot conflict prompts (use `detectSlotConflicts` and pass decisions)
 * - Confirmation prompts
 * - npm dependency installation
 * - Env var prompting
 * - Output formatting
 */
export async function addComponents(opts: AddComponentsOpts): Promise<AddResult> {
  const { cwd, overwrite, slotDecisions } = opts;

  const config = await readConfig(cwd);
  if (!config) {
    throw new NotInitializedError(cwd);
  }

  const lock = await readLock(cwd);

  // --- Parse type filter ---
  const { typeFilter, components: filteredComponents, error: typeError } = parseTypeFilter(
    opts.components,
    opts.typeFilter,
  );
  if (typeError) {
    throw new Error(typeError);
  }

  // --- Resolve "routes" alias ---
  const resolvedComponents = filteredComponents.map((c) => {
    if (c === "routes") return resolveRoutesAlias(config);
    return c;
  });

  const refs = resolvedComponents.map(parseComponentRef);
  const fetcher = new RegistryFetcher(config.registries);

  // --- Disambiguation ---
  const allIndexItems = await fetchAllIndexItems(config.registries);
  const disambiguationCandidates = findDisambiguationCandidates(
    resolvedComponents,
    allIndexItems,
    refs,
    typeFilter,
  );

  // Check for unresolved disambiguation (caller should have handled this)
  const unresolved = disambiguationCandidates.filter((c) => c.needsDisambiguation);
  if (unresolved.length > 0) {
    // If there are ambiguous names that weren't pre-resolved, just use the first match
    // The CLI wrapper should have resolved these before calling addComponents
    // For MCP/programmatic use, we pick the first match
  }

  // Build pre-resolved types map and expanded names
  const preResolvedTypes = new Map<string, ComponentType>();
  const expandedNames: string[] = [];

  for (const candidate of disambiguationCandidates) {
    if (candidate.resolved) {
      preResolvedTypes.set(candidate.resolved.name, candidate.resolved.type);
      expandedNames.push(candidate.resolved.name);
    } else if (candidate.needsDisambiguation) {
      // Shouldn't happen if caller handles disambiguation, but fall through
      // Use first exact match or fuzzy match
      const matches = candidate.exactMatches.length > 0
        ? candidate.exactMatches
        : candidate.fuzzyMatches;
      if (matches.length > 0) {
        preResolvedTypes.set(matches[0].name, matches[0].type);
        expandedNames.push(matches[0].name);
      } else {
        expandedNames.push(candidate.input);
      }
    } else {
      // No match found -- let resolution produce the error
      expandedNames.push(candidate.input);
    }
  }

  // --- Dependency resolution ---
  let resolved: RegistryItem[];
  try {
    resolved = await resolveDependencies(expandedNames, async (name) => {
      const ref = refs.find((r) => r.name === name) ?? { namespace: "@kitn", name, version: undefined };
      const index = await fetcher.fetchIndex(ref.namespace);

      const preResolved = preResolvedTypes.get(name);
      const indexItem = preResolved
        ? index.items.find((i) => i.name === name && i.type === preResolved)
        : index.items.find((i) => i.name === name);

      if (!indexItem) throw new Error(`Component '${name}' not found in ${ref.namespace} registry`);
      const dir = typeToDir[indexItem.type];
      return fetcher.fetchItem(name, dir as any, ref.namespace, ref.version);
    });
  } catch (err: any) {
    throw new Error(`Failed to resolve dependencies: ${err.message}`);
  }

  // --- Slot conflict detection ---
  const slotConflicts = detectSlotConflicts(resolved, lock);

  // Process slot replacements based on decisions
  const slotReplacements = new Map<string, string>();
  if (slotDecisions) {
    for (const conflict of slotConflicts) {
      const decision = slotDecisions[conflict.existing];
      if (decision === "replace") {
        slotReplacements.set(conflict.existing, conflict.incoming);
      }
    }
  }

  await processSlotReplacements(slotReplacements, lock, config, cwd);

  // --- Collect npm dependencies ---
  const allDeps: string[] = [];
  const allDevDeps: string[] = [];
  for (const item of resolved) {
    if (item.dependencies) allDeps.push(...item.dependencies);
    if (item.devDependencies) allDevDeps.push(...item.devDependencies);
  }
  const uniqueDeps = [...new Set(allDeps)];
  const uniqueDevDeps = [...new Set(allDevDeps)].filter((d) => !uniqueDeps.includes(d));

  // --- File processing ---
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const fileConflicts: FileConflict[] = [];
  const installed: InstalledComponent[] = [];
  const errors: Array<{ component: string; error: string }> = [];

  for (const item of resolved) {
    try {
      // Skip file processing for packages already installed with identical content
      const existingInstall = lock[item.name];
      if (existingInstall && item.type === "kitn:package") {
        const allContent = item.files.map((f) => f.content).join("\n");
        if (contentHash(allContent) === existingInstall.hash) {
          continue;
        }
      }

      const installedFiles: string[] = [];

      if (item.type === "kitn:package") {
        // Package install -- multi-file, preserved directory structure
        const baseDir = config.aliases.base ?? "src/ai";

        for (const file of item.files) {
          const targetPath = join(cwd, baseDir, file.path);
          const relativePath = join(baseDir, file.path);

          const status = await checkFileStatus(targetPath, file.content);

          switch (status) {
            case FileStatus.New:
              await writeComponentFile(targetPath, file.content);
              created.push(relativePath);
              installedFiles.push(relativePath);
              break;

            case FileStatus.Identical:
              skipped.push(relativePath);
              installedFiles.push(relativePath);
              break;

            case FileStatus.Different:
              if (overwrite) {
                await writeComponentFile(targetPath, file.content);
                updated.push(relativePath);
                installedFiles.push(relativePath);
              } else {
                const existing = await readExistingFile(targetPath);
                const diff = generateDiff(relativePath, existing ?? "", file.content);
                fileConflicts.push({
                  path: relativePath,
                  component: item.name,
                  existingContent: existing ?? "",
                  newContent: file.content,
                  diff,
                });
                skipped.push(relativePath);
                installedFiles.push(relativePath);
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

        installed.push({
          name: item.name,
          files: installedFiles,
          version: item.version ?? "1.0.0",
        });

      } else {
        // Regular component install -- single file, import rewriting
        const ref = refs.find((r) => r.name === item.name) ?? { namespace: "@kitn", name: item.name, version: undefined };
        const ns = ref.namespace;

        for (const file of item.files) {
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
              installedFiles.push(relativePath);
              break;

            case FileStatus.Identical:
              skipped.push(relativePath);
              installedFiles.push(relativePath);
              break;

            case FileStatus.Different:
              if (overwrite) {
                await writeComponentFile(targetPath, content);
                updated.push(relativePath);
                installedFiles.push(relativePath);
              } else {
                const existing = await readExistingFile(targetPath);
                const diff = generateDiff(relativePath, existing ?? "", content);
                fileConflicts.push({
                  path: relativePath,
                  component: item.name,
                  existingContent: existing ?? "",
                  newContent: content,
                  diff,
                });
                skipped.push(relativePath);
                installedFiles.push(relativePath);
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

        installed.push({
          name: item.name,
          files: installedFiles,
          version: item.version ?? "1.0.0",
        });
      }
    } catch (err: any) {
      errors.push({ component: item.name, error: err.message });
    }
  }

  // --- Barrel management ---
  const BARREL_ELIGIBLE: Set<string> = new Set(["kitn:agent", "kitn:tool", "kitn:skill", "kitn:cron"]);
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

  let barrelUpdated = false;
  let barrelIsNew = false;

  if (barrelImports.length > 0) {
    const barrelExisted = existsSync(barrelPath);
    let barrelContent: string;

    if (barrelExisted) {
      barrelContent = await readFile(barrelPath, "utf-8");
    } else {
      await mkdir(barrelDir, { recursive: true });
      barrelContent = createBarrelFile();
      barrelIsNew = true;
    }

    for (const importPath of barrelImports) {
      barrelContent = addImportToBarrel(barrelContent, importPath);
    }

    await writeFile(barrelPath, barrelContent);
    barrelUpdated = true;
  }

  // --- Write config and lock ---
  await writeConfig(cwd, config);
  await writeLock(cwd, lock);

  // --- Collect env vars ---
  const envVars = collectEnvVars(resolved);

  return {
    installed,
    slotConflicts: slotDecisions ? [] : slotConflicts,
    fileConflicts,
    created,
    updated,
    skipped,
    npmDeps: uniqueDeps,
    npmDevDeps: uniqueDevDeps,
    envVars,
    errors,
    resolved,
    barrelUpdated,
    barrelIsNew,
  };
}

/**
 * Write a single file that was previously reported as a conflict.
 * Used by CLI after user confirms overwrite for a specific file.
 */
export async function writeConflictFile(filePath: string, content: string, cwd: string): Promise<void> {
  await writeComponentFile(join(cwd, filePath), content);
}
