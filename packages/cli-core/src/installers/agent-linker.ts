/**
 * Regex-based agent file manipulation for linking/unlinking tools.
 *
 * Works on string content (no file I/O) — same approach as barrel-manager.ts.
 */

export interface LinkResult {
  content: string;
  changed: boolean;
  error?: string;
}

export interface ToolRef {
  exportName: string;
  importPath: string;
}

/**
 * Link a tool into an agent file by adding an import and inserting the tool
 * into the `tools: { ... }` object.
 */
export function linkToolToAgent(
  content: string,
  tool: ToolRef,
  toolKey?: string,
): LinkResult {
  const key = toolKey ?? tool.exportName;
  const { exportName, importPath } = tool;

  // --- Check if already linked (idempotent) ---
  const toolEntry = key === exportName ? exportName : `${key}: ${exportName}`;
  if (hasToolEntry(content, key)) {
    return { content, changed: false };
  }

  // --- Insert import ---
  const importLine = `import { ${exportName} } from "${importPath}";`;
  let result = content;

  if (!result.includes(importLine)) {
    const lines = result.split("\n");
    let lastImportIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s+/.test(lines[i])) lastImportIndex = i;
    }

    if (lastImportIndex === -1) {
      // No imports found — prepend
      result = `${importLine}\n${result}`;
    } else {
      lines.splice(lastImportIndex + 1, 0, importLine);
      result = lines.join("\n");
    }
  }

  // --- Insert tool entry ---
  const insertResult = insertToolEntry(result, key, exportName);
  if (insertResult.error) {
    return {
      content,
      changed: false,
      error:
        `Could not auto-modify the agent file. Add manually:\n` +
        `  1. Import: ${importLine}\n` +
        `  2. Add to tools: { ${toolEntry} }`,
    };
  }

  return { content: insertResult.content, changed: true };
}

/**
 * Unlink a tool from an agent file by removing it from the `tools` object
 * and removing the import if the export is no longer referenced.
 */
export function unlinkToolFromAgent(
  content: string,
  tool: ToolRef,
  toolKey?: string,
): LinkResult {
  const key = toolKey ?? tool.exportName;
  const { exportName, importPath } = tool;

  if (!hasToolEntry(content, key)) {
    return { content, changed: false };
  }

  // --- Remove tool entry ---
  const removeResult = removeToolEntry(content, key, exportName);
  if (removeResult.error) {
    return {
      content,
      changed: false,
      error:
        `Could not auto-modify the agent file. Remove manually:\n` +
        `  1. Remove from tools: ${key === exportName ? key : `${key}: ${exportName}`}\n` +
        `  2. Remove import if unused: import { ${exportName} } from "${importPath}";`,
    };
  }

  let result = removeResult.content;

  // --- Remove import if exportName is no longer referenced in file ---
  if (!isExportNameReferenced(result, exportName)) {
    result = removeImportLine(result, exportName, importPath);
  }

  return { content: result, changed: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Check whether a key already exists in the tools object. */
function hasToolEntry(content: string, key: string): boolean {
  // Match "key:" or "key," or "key }" or standalone shorthand "key" in tools
  // We look for the key inside a tools: { ... } block
  const toolsMatch = extractToolsBlock(content);
  if (!toolsMatch) return false;
  const toolsContent = toolsMatch.inner;

  // Check for "key: value" or shorthand "key" (as standalone identifier)
  const keyPattern = new RegExp(
    `(?:^|[,{\\s])${escapeRegex(key)}(?:\\s*[:,}\\s]|$)`,
  );
  return keyPattern.test(toolsContent);
}

interface ToolsBlock {
  /** Full match including "tools: { ... }" */
  full: string;
  /** Content inside the braces */
  inner: string;
  /** Start index in the original string */
  startIndex: number;
  /** Indentation of the "tools:" line */
  indent: string;
}

/** Extract the tools block from file content, handling both single-line and multiline. */
function extractToolsBlock(content: string): ToolsBlock | null {
  // First try single-line: tools: { ... }
  const singleLine = /^([ \t]*)tools\s*:\s*\{([^}]*)\}/m;
  const singleMatch = singleLine.exec(content);
  if (singleMatch) {
    return {
      full: singleMatch[0],
      inner: singleMatch[2],
      startIndex: singleMatch.index,
      indent: singleMatch[1],
    };
  }

  // Multiline: find "tools: {" then match to closing "}"
  const multiStart = /^([ \t]*)tools\s*:\s*\{/m;
  const multiMatch = multiStart.exec(content);
  if (!multiMatch) return null;

  const braceStart = multiMatch.index + multiMatch[0].length;
  let depth = 1;
  let i = braceStart;
  while (i < content.length && depth > 0) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") depth--;
    i++;
  }
  if (depth !== 0) return null;

  const full = content.slice(multiMatch.index, i);
  const inner = content.slice(braceStart, i - 1);
  return {
    full,
    inner,
    startIndex: multiMatch.index,
    indent: multiMatch[1],
  };
}

/** Insert a tool entry into the tools object. */
function insertToolEntry(
  content: string,
  key: string,
  exportName: string,
): { content: string; error?: string } {
  const block = extractToolsBlock(content);
  if (!block) return { content, error: "no tools block found" };

  const entry = key === exportName ? key : `${key}: ${exportName}`;
  const trimmedInner = block.inner.trim();

  let newToolsContent: string;

  if (trimmedInner === "") {
    // Empty tools: {} → tools: { entry }
    newToolsContent = `tools: { ${entry} }`;
  } else if (!block.inner.includes("\n")) {
    // Single-line with existing entries: tools: { a, b } → tools: { a, b, entry }
    // Remove trailing whitespace inside braces
    const cleaned = trimmedInner.replace(/,?\s*$/, "");
    newToolsContent = `tools: { ${cleaned}, ${entry} }`;
  } else {
    // Multiline: insert before closing brace with proper indentation
    const entryIndent = block.indent + "  ";
    // Ensure the existing content ends with a comma
    const existingTrimmed = block.inner.trimEnd();
    const withComma = existingTrimmed.endsWith(",")
      ? existingTrimmed
      : existingTrimmed + ",";
    newToolsContent = `tools: {\n${withComma}\n${entryIndent}${entry},\n${block.indent}}`;
  }

  const newContent = content.replace(block.full, newToolsContent);
  return { content: newContent };
}

/** Remove a tool entry from the tools object. */
function removeToolEntry(
  content: string,
  key: string,
  exportName: string,
): { content: string; error?: string } {
  const block = extractToolsBlock(content);
  if (!block) return { content, error: "no tools block found" };

  const trimmedInner = block.inner.trim();

  if (!block.inner.includes("\n")) {
    // Single-line: parse entries, filter out the matching one
    const entries = trimmedInner
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e !== "");

    const filtered = entries.filter((e) => {
      // Match "key: value" or shorthand "key"
      const colonIdx = e.indexOf(":");
      const entryKey = colonIdx >= 0 ? e.slice(0, colonIdx).trim() : e.trim();
      return entryKey !== key;
    });

    const newInner =
      filtered.length === 0 ? "" : ` ${filtered.join(", ")} `;
    const newBlock = `tools: {${newInner}}`;
    return { content: content.replace(block.full, newBlock) };
  } else {
    // Multiline: remove the line matching the key
    const lines = block.inner.split("\n");
    const keyPattern = new RegExp(
      `^\\s*${escapeRegex(key)}\\s*(?::|,|$)`,
    );
    const filtered = lines.filter((line) => !keyPattern.test(line));

    // Check if all remaining lines are empty/whitespace
    const hasEntries = filtered.some((l) => l.trim() !== "");

    if (!hasEntries) {
      const newBlock = `tools: {}`;
      return { content: content.replace(block.full, newBlock) };
    }

    // Clean up: ensure last entry line ends with comma
    const cleanedLines = filtered.slice();
    // Find last non-empty line and ensure trailing comma
    for (let i = cleanedLines.length - 1; i >= 0; i--) {
      if (cleanedLines[i].trim() !== "") {
        if (!cleanedLines[i].trimEnd().endsWith(",")) {
          cleanedLines[i] = cleanedLines[i].trimEnd() + ",";
        }
        break;
      }
    }

    const newBlock = `tools: {\n${cleanedLines.join("\n")}\n${block.indent}}`;
    return { content: content.replace(block.full, newBlock) };
  }
}

/** Check if an export name is still referenced in the content (outside of import lines). */
function isExportNameReferenced(content: string, exportName: string): boolean {
  const lines = content.split("\n");
  for (const line of lines) {
    // Skip import lines
    if (/^import\s+/.test(line)) continue;
    // Check if the export name appears as a word
    const wordPattern = new RegExp(`\\b${escapeRegex(exportName)}\\b`);
    if (wordPattern.test(line)) return true;
  }
  return false;
}

/** Remove an import line for a specific export from a specific path. */
function removeImportLine(
  content: string,
  exportName: string,
  importPath: string,
): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Single-line import: import { foo } from "path";
    // Also handles: import { foo, bar } from "path";
    const singleImportMatch = line.match(
      /^import\s*\{([^}]+)\}\s*from\s*["'](.+?)["']\s*;?\s*$/,
    );

    if (singleImportMatch && singleImportMatch[2] === importPath) {
      const imports = singleImportMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");

      if (imports.length === 1 && imports[0] === exportName) {
        // Only import — remove the entire line
        // Also remove a following blank line if present
        if (i + 1 < lines.length && lines[i + 1].trim() === "") {
          i++; // skip blank line
        }
        continue;
      }

      // Multiple imports — remove just this one
      const remaining = imports.filter((s) => s !== exportName);
      result.push(
        `import { ${remaining.join(", ")} } from "${importPath}";`,
      );
      continue;
    }

    // Multi-line import: spans multiple lines
    // Check if this starts a multi-line import for our path
    if (
      /^import\s*\{/.test(line) &&
      !line.includes("}") &&
      content.includes(importPath)
    ) {
      // Collect all lines until closing }
      const importLines = [line];
      let j = i + 1;
      while (j < lines.length && !lines[j].includes("}")) {
        importLines.push(lines[j]);
        j++;
      }
      if (j < lines.length) {
        importLines.push(lines[j]);
      }

      const fullImport = importLines.join("\n");
      if (fullImport.includes(importPath)) {
        // Extract all imported names
        const namesMatch = fullImport.match(/\{([^}]+)\}/);
        if (namesMatch) {
          const imports = namesMatch[1]
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== "");

          if (imports.length === 1 && imports[0] === exportName) {
            // Skip entire multi-line import
            i = j;
            // Also skip trailing blank line
            if (i + 1 < lines.length && lines[i + 1].trim() === "") {
              i++;
            }
            continue;
          }

          // Remove just this export from the multi-line import
          const remaining = imports.filter((s) => s !== exportName);
          if (remaining.length <= 2) {
            result.push(
              `import { ${remaining.join(", ")} } from "${importPath}";`,
            );
          } else {
            result.push(`import {`);
            remaining.forEach((name, idx) => {
              result.push(
                `  ${name}${idx < remaining.length - 1 ? "," : ""}`,
              );
            });
            result.push(`} from "${importPath}";`);
          }
          i = j;
          continue;
        }
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
