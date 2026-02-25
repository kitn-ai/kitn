import * as p from "@clack/prompts";
import pc from "picocolors";
import { join } from "path";
import { readConfig } from "../utils/config.js";
import { RegistryFetcher } from "../registry/fetcher.js";
import { readExistingFile, generateDiff } from "../installers/file-writer.js";
import { typeToDir } from "../registry/schema.js";

export async function diffCommand(componentName: string) {
  const cwd = process.cwd();
  const config = await readConfig(cwd);
  if (!config) {
    p.log.error("No kitn.json found. Run `kitn init` first.");
    process.exit(1);
  }

  // Resolve "routes" alias to framework-specific package name
  const resolvedName =
    componentName === "routes" ? (config.framework ?? "hono") : componentName;

  const installed = config._installed?.[resolvedName];
  if (!installed) {
    p.log.error(`Component '${resolvedName}' is not installed.`);
    process.exit(1);
  }

  const fetcher = new RegistryFetcher(config.registries);
  const index = await fetcher.fetchIndex();
  const indexItem = index.items.find((i) => i.name === resolvedName);
  if (!indexItem) {
    p.log.error(`Component '${resolvedName}' not found in registry.`);
    process.exit(1);
  }

  const dir = typeToDir[indexItem.type] as any;
  const registryItem = await fetcher.fetchItem(resolvedName, dir);

  let hasDiff = false;
  for (const file of registryItem.files) {
    if (indexItem.type === "kitn:package") {
      // Packages use base alias + preserved directory structure
      const baseDir = config.aliases.base ?? "src/ai";
      const localPath = join(cwd, baseDir, file.path);
      const relativePath = join(baseDir, file.path);
      const localContent = await readExistingFile(localPath);

      if (localContent === null) {
        p.log.warn(`${relativePath}: file missing locally`);
        hasDiff = true;
      } else if (localContent !== file.content) {
        const diff = generateDiff(relativePath, localContent, file.content);
        console.log(diff);
        hasDiff = true;
      }
    } else {
      // Regular components use type-based alias directories
      const fileName = file.path.split("/").pop()!;
      const aliasKey = (() => {
        switch (indexItem.type) {
          case "kitn:agent": return "agents";
          case "kitn:tool": return "tools";
          case "kitn:skill": return "skills";
          case "kitn:storage": return "storage";
        }
      })() as "agents" | "tools" | "skills" | "storage";
      const localPath = join(cwd, config.aliases[aliasKey], fileName);
      const localContent = await readExistingFile(localPath);

      if (localContent === null) {
        p.log.warn(`${fileName}: file missing locally`);
        hasDiff = true;
      } else if (localContent !== file.content) {
        const diff = generateDiff(fileName, localContent, file.content);
        console.log(diff);
        hasDiff = true;
      }
    }
  }

  if (!hasDiff) {
    p.log.success(`${resolvedName}: up to date, no differences.`);
  }
}
