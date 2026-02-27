import * as p from "@clack/prompts";
import pc from "picocolors";
import { join } from "path";
import { readConfig, writeConfig, getInstallPath } from "../utils/config.js";
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
import { createBarrelFile, addImportToBarrel } from "../installers/barrel-manager.js";
import { contentHash } from "../utils/hash.js";
import { parseComponentRef, type ComponentRef } from "../utils/parse-ref.js";
import { typeToDir, type RegistryItem, type ComponentType } from "../registry/schema.js";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
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

  if (components.length === 0) {
    p.log.error("Please specify at least one component to add.");
    process.exit(1);
  }

  // Resolve "routes" to framework-specific package name, then parse refs
  const resolvedComponents = components.map((c) => {
    if (c === "routes") {
      const fw = config.framework ?? "hono";
      return fw;
    }
    return c;
  });

  const refs = resolvedComponents.map(parseComponentRef);
  const fetcher = new RegistryFetcher(config.registries);

  const s = p.spinner();
  s.start("Resolving dependencies...");

  let resolved: RegistryItem[];
  try {
    resolved = await resolveDependencies(resolvedComponents, async (name) => {
      const ref = refs.find((r) => r.name === name) ?? { namespace: "@kitn", name, version: undefined };
      const index = await fetcher.fetchIndex(ref.namespace);
      const indexItem = index.items.find((i) => i.name === name);
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

  p.log.info("Components to install:\n" + resolved.map((item) => {
    const isExplicit = resolvedComponents.includes(item.name) || components.includes(item.name);
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

      // Track in installed
      const installed = config.installed ?? {};
      const allContent = item.files.map((f) => f.content).join("\n");
      const ref = refs.find((r) => r.name === item.name) ?? { namespace: "@kitn", name: item.name, version: undefined };
      const installedKey = ref.namespace === "@kitn" ? item.name : `${ref.namespace}/${item.name}`;
      installed[installedKey] = {
        registry: ref.namespace,
        version: item.version ?? "1.0.0",
        installedAt: new Date().toISOString(),
        files: item.files.map((f) => join(baseDir, f.path)),
        hash: contentHash(allContent),
      };
      config.installed = installed;

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

      // Track in installed
      const installed = config.installed ?? {};
      const allContent = item.files.map((f) => {
        const fn = f.path.split("/").pop()!;
        return rewriteKitnImports(f.content, item.type, fn, config.aliases);
      }).join("\n");
      const installedKey = ns === "@kitn" ? item.name : `${ns}/${item.name}`;
      installed[installedKey] = {
        registry: ns,
        version: item.version ?? "1.0.0",
        installedAt: new Date().toISOString(),
        files: item.files.map((f) => {
          const fileName = f.path.split("/").pop()!;
          return getInstallPath(config, item.type as Exclude<ComponentType, "kitn:package">, fileName, ns);
        }),
        hash: contentHash(allContent),
      };
      config.installed = installed;
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
          `await ai.initialize();`,
        ].join("\n"),
        "Add this to your server entry point",
      );
    }
  }

  await writeConfig(cwd, config);

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
    p.log.success(`Created ${created.length} file(s):\n` + created.map((f) => `  ${pc.green("+")} ${f}`).join("\n"));
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
  const installedNames = new Set(resolved.map((r) => r.name));
  const hints: string[] = [];

  if (installedNames.has("core") && !installedNames.has(config.framework ?? "hono")) {
    hints.push(`Run ${pc.cyan(`kitn add routes`)} to install the HTTP adapter.`);
  }

  const fw = config.framework ?? "hono";
  if (installedNames.has(fw) || (installedNames.has("core") && installedNames.has(fw))) {
    hints.push(`Configure your AI provider in ${pc.bold(baseDir + "/plugin.ts")}, then add to your server:`);
    hints.push("");
    hints.push(pc.dim(`  import { ai } from "./${baseDir.replace(/^src\//, "")}/plugin";`));
    hints.push(pc.dim(``));
    hints.push(pc.dim(`  app.route("/api", ai.router);`));
    hints.push(pc.dim(`  await ai.initialize();`));
    hints.push("");
  }

  if (hints.length > 0) {
    p.log.message(pc.bold("\nNext steps:") + "\n" + hints.join("\n"));
  }

  p.outro(pc.green("Done!"));
}
