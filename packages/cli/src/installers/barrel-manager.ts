const EXPORT_LINE = 'export { registerWithPlugin } from "@kitnai/core";';
const BARREL_COMMENT = "// Managed by kitn CLI — components auto-imported below";

export function createBarrelFile(): string {
  return `${BARREL_COMMENT}\n${EXPORT_LINE}\n`;
}

export function addImportToBarrel(content: string, importPath: string): string {
  const importLine = `import "${importPath}";`;

  // Idempotent — skip if already present
  if (content.includes(importLine)) return content;

  // Insert before the export line
  const exportIndex = content.indexOf(EXPORT_LINE);
  if (exportIndex === -1) {
    // No export line found — append both
    return `${content.trimEnd()}\n${importLine}\n${EXPORT_LINE}\n`;
  }

  const before = content.slice(0, exportIndex);
  const after = content.slice(exportIndex);
  return `${before}${importLine}\n${after}`;
}

export function removeImportFromBarrel(
  content: string,
  importPath: string,
): string {
  const importLine = `import "${importPath}";`;
  return content
    .split("\n")
    .filter((line) => line.trim() !== importLine)
    .join("\n");
}

export function parseBarrelFile(content: string): string[] {
  const imports: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^import\s+["'](.+)["'];?\s*$/);
    if (match) imports.push(match[1]);
  }
  return imports;
}
