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

  const installed = config._installed?.[componentName];
  if (!installed) {
    p.log.error(`Component '${componentName}' is not installed.`);
    process.exit(1);
  }

  const fetcher = new RegistryFetcher(config.registries);
  const index = await fetcher.fetchIndex();
  const indexItem = index.items.find((i) => i.name === componentName);
  if (!indexItem) {
    p.log.error(`Component '${componentName}' not found in registry.`);
    process.exit(1);
  }

  const dir = typeToDir[indexItem.type] as any;
  const registryItem = await fetcher.fetchItem(componentName, dir);

  let hasDiff = false;
  for (const file of registryItem.files) {
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

  if (!hasDiff) {
    p.log.success(`${componentName}: up to date, no differences.`);
  }
}
