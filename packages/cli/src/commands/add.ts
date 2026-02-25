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
import { installDependencies } from "../installers/dep-installer.js";
import { checkEnvVars } from "../installers/env-checker.js";
import { rewriteKitnImports } from "../installers/import-rewriter.js";
import { contentHash } from "../utils/hash.js";
import { typeToDir, type RegistryItem, type ComponentType } from "../registry/schema.js";

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

  const fetcher = new RegistryFetcher(config.registries);

  const s = p.spinner();
  s.start("Resolving dependencies...");

  let resolved: RegistryItem[];
  try {
    resolved = await resolveDependencies(components, async (name) => {
      const index = await fetcher.fetchIndex();
      const indexItem = index.items.find((i) => i.name === name);
      if (!indexItem) throw new Error(`Component '${name}' not found in registry`);
      const dir = typeToDir[indexItem.type];
      return fetcher.fetchItem(name, dir as any);
    });
  } catch (err: any) {
    s.stop(pc.red("Failed to resolve dependencies"));
    p.log.error(err.message);
    process.exit(1);
  }

  s.stop(`Resolved ${resolved.length} component(s)`);

  p.log.info("Components to install:");
  for (const item of resolved) {
    const isExplicit = components.includes(item.name);
    const label = isExplicit ? item.name : `${item.name} ${pc.dim("(dependency)")}`;
    p.log.message(`  ${pc.cyan(label)}`);
  }

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const allDeps: string[] = [];
  const allEnvWarnings: string[] = [];

  for (const item of resolved) {
    if (item.dependencies) allDeps.push(...item.dependencies);
    if (item.envVars) {
      allEnvWarnings.push(...checkEnvVars(item.envVars));
    }

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
      const targetPath = join(cwd, config.aliases[aliasKey], fileName);
      const relativePath = join(config.aliases[aliasKey], fileName);
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

    const installed = config._installed ?? {};
    const allContent = item.files.map((f) => {
      const fn = f.path.split("/").pop()!;
      return rewriteKitnImports(f.content, item.type, fn, config.aliases);
    }).join("\n");
    installed[item.name] = {
      version: item.version ?? "1.0.0",
      installedAt: new Date().toISOString(),
      files: item.files.map((f) => {
        const aliasKey = (() => {
          switch (item.type) {
            case "kitn:agent": return "agents";
            case "kitn:tool": return "tools";
            case "kitn:skill": return "skills";
            case "kitn:storage": return "storage";
          }
        })() as "agents" | "tools" | "skills" | "storage";
        const fileName = f.path.split("/").pop()!;
        return join(config.aliases[aliasKey], fileName);
      }),
      hash: contentHash(allContent),
    };
    config._installed = installed;
  }

  await writeConfig(cwd, config);

  const uniqueDeps = [...new Set(allDeps)];
  if (uniqueDeps.length > 0) {
    const pm = await detectPackageManager(cwd);
    if (pm) {
      s.start(`Installing ${uniqueDeps.length} npm dependenc${uniqueDeps.length === 1 ? "y" : "ies"}...`);
      try {
        installDependencies(pm, uniqueDeps, cwd);
        s.stop("Dependencies installed");
      } catch {
        s.stop(pc.yellow("Some dependencies failed to install"));
      }
    }
  }

  if (created.length > 0) {
    p.log.success(`Created ${created.length} file(s):`);
    for (const f of created) p.log.message(`  ${pc.green("+")} ${f}`);
  }
  if (updated.length > 0) {
    p.log.success(`Updated ${updated.length} file(s):`);
    for (const f of updated) p.log.message(`  ${pc.yellow("~")} ${f}`);
  }
  if (skipped.length > 0) {
    p.log.info(`Skipped ${skipped.length} file(s):`);
    for (const f of skipped) p.log.message(`  ${pc.dim("-")} ${f}`);
  }

  if (allEnvWarnings.length > 0) {
    p.log.warn("Missing environment variables:");
    for (const w of allEnvWarnings) p.log.message(w);
  }

  for (const item of resolved) {
    if (item.docs) {
      p.log.info(`${pc.bold(item.name)}: ${item.docs}`);
    }
  }

  p.outro(pc.green("Done!"));
}
