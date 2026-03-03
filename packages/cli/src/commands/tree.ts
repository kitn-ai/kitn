import * as p from "@clack/prompts";
import pc from "picocolors";
import { componentTree } from "@kitnai/cli-core";
import type { TreeNode } from "@kitnai/cli-core";
import { requireConfig } from "../utils/auto-init.js";

export async function treeCommand() {
  let cwd = process.cwd();
  ({ cwd } = await requireConfig(cwd));

  let result;
  try {
    result = await componentTree({ cwd });
  } catch (err: any) {
    p.log.error(err.message);
    process.exit(1);
  }

  if (result.roots.length === 0) {
    p.log.info("No installed components.");
    return;
  }

  // Render with colors
  const lines: string[] = [];

  function renderNode(node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean) {
    const connector = isRoot ? "" : isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
    const deduped = node.deduped ? pc.dim(" [deduped]") : "";
    const name = node.deduped ? pc.dim(node.name) : pc.bold(node.name);
    const type = pc.dim(`(${node.type})`);
    lines.push(`${prefix}${connector}${name} ${type}${deduped}`);

    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "\u2502   ");
    for (let i = 0; i < node.children.length; i++) {
      renderNode(node.children[i], childPrefix, i === node.children.length - 1, false);
    }
  }

  for (const root of result.roots) {
    renderNode(root, "  ", true, true);
  }

  console.log();
  for (const line of lines) {
    console.log(line);
  }
  console.log();

  p.log.info(
    `${result.totalComponents} component(s), ${result.totalDependencies} dependency link(s)`,
  );
}
