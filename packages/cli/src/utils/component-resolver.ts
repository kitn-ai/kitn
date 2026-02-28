import { readdir, readFile } from "fs/promises";
import { join, relative, dirname } from "path";
import type { KitnConfig } from "./config.js";
import { readLock } from "./config.js";

export interface ResolvedTool {
  filePath: string;       // absolute path to tool file
  exportName: string;     // e.g. "weatherTool"
  importPath: string;     // relative .js path from agent dir
}

export interface ResolvedAgent {
  filePath: string;       // absolute path to agent file
  name: string;           // agent name from registerAgent call or filename
}

/**
 * Strip a type-specific suffix from a component name.
 * e.g. "weather-tool" -> "weather", "general-agent" -> "general"
 */
function stripSuffix(name: string, suffix: string): string {
  if (name.endsWith(`-${suffix}`)) {
    return name.slice(0, -(suffix.length + 1));
  }
  return name;
}

/** Get the absolute tools directory from config. */
function toolsDir(config: KitnConfig, cwd: string): string {
  const baseAlias = config.aliases.base ?? "src/ai";
  const tools = config.aliases.tools ?? join(baseAlias, "tools");
  return join(cwd, tools);
}

/** Get the absolute agents directory from config. */
function agentsDir(config: KitnConfig, cwd: string): string {
  const baseAlias = config.aliases.base ?? "src/ai";
  const agents = config.aliases.agents ?? join(baseAlias, "agents");
  return join(cwd, agents);
}

/** Try to find a .ts file in a directory matching one of the candidate names. */
async function findFile(dir: string, candidates: string[]): Promise<string | null> {
  for (const name of candidates) {
    const filePath = join(dir, `${name}.ts`);
    try {
      await readFile(filePath);
      return filePath;
    } catch {
      // file doesn't exist, try next
    }
  }
  return null;
}

/** Extract the first `export const <name>` identifier from a TypeScript source file. */
function parseExportName(source: string): string | null {
  const match = source.match(/export\s+const\s+(\w+)/);
  return match ? match[1] : null;
}

/** Extract agent name from `registerAgent({ name: "..." })` or `name: "..."` pattern. */
function parseAgentName(source: string): string | null {
  const match = source.match(/registerAgent\s*\(\s*\{[^}]*name:\s*"([^"]+)"/s);
  return match ? match[1] : null;
}

/** Compute a relative import path from one directory to a file, using .js extension. */
function computeImportPath(fromDir: string, toFile: string): string {
  let rel = relative(fromDir, toFile);
  // Ensure it starts with "./" for relative imports
  if (!rel.startsWith(".")) {
    rel = `./${rel}`;
  }
  // Replace .ts extension with .js
  return rel.replace(/\.ts$/, ".js");
}

/**
 * Resolve a tool by name. Checks the lock file first, then scans the tools directory.
 * Returns null if the tool is not found.
 */
export async function resolveToolByName(
  name: string,
  config: KitnConfig,
  cwd: string,
): Promise<ResolvedTool | null> {
  const tDir = toolsDir(config, cwd);
  const aDir = agentsDir(config, cwd);

  // 1. Check lock file for installed file path
  const lock = await readLock(cwd);
  for (const [componentName, entry] of Object.entries(lock)) {
    if (componentName === name || componentName === `${name}-tool`) {
      // Find a tool file in the entry's files list
      const toolFile = entry.files.find((f) => {
        const toolsAlias = config.aliases.tools ?? join(config.aliases.base ?? "src/ai", "tools");
        return f.startsWith(toolsAlias);
      });
      if (toolFile) {
        const filePath = join(cwd, toolFile);
        try {
          const source = await readFile(filePath, "utf-8");
          const exportName = parseExportName(source);
          if (exportName) {
            return {
              filePath,
              exportName,
              importPath: computeImportPath(aDir, filePath),
            };
          }
        } catch {
          // File from lock doesn't exist on disk, fall through to directory scan
        }
      }
    }
  }

  // 2. Scan tools directory
  const candidates = [name, stripSuffix(name, "tool")];
  // Deduplicate (if name doesn't have -tool suffix, both will be the same)
  const uniqueCandidates = [...new Set(candidates)];

  const filePath = await findFile(tDir, uniqueCandidates);
  if (!filePath) return null;

  const source = await readFile(filePath, "utf-8");
  const exportName = parseExportName(source);
  if (!exportName) return null;

  return {
    filePath,
    exportName,
    importPath: computeImportPath(aDir, filePath),
  };
}

/**
 * Resolve an agent by name. Checks the lock file first, then scans the agents directory.
 * Returns null if the agent is not found.
 */
export async function resolveAgentByName(
  name: string,
  config: KitnConfig,
  cwd: string,
): Promise<ResolvedAgent | null> {
  const aDir = agentsDir(config, cwd);

  // 1. Check lock file for installed file path
  const lock = await readLock(cwd);
  for (const [componentName, entry] of Object.entries(lock)) {
    if (componentName === name || componentName === `${name}-agent`) {
      const agentFile = entry.files.find((f) => {
        const agentsAlias = config.aliases.agents ?? join(config.aliases.base ?? "src/ai", "agents");
        return f.startsWith(agentsAlias);
      });
      if (agentFile) {
        const filePath = join(cwd, agentFile);
        try {
          const source = await readFile(filePath, "utf-8");
          const agentName = parseAgentName(source);
          return {
            filePath,
            name: agentName ?? componentName,
          };
        } catch {
          // File from lock doesn't exist on disk, fall through
        }
      }
    }
  }

  // 2. Scan agents directory
  const candidates = [name, stripSuffix(name, "agent")];
  const uniqueCandidates = [...new Set(candidates)];

  const filePath = await findFile(aDir, uniqueCandidates);
  if (!filePath) return null;

  const source = await readFile(filePath, "utf-8");
  const agentName = parseAgentName(source);
  const fallbackName = filePath.split("/").pop()!.replace(/\.ts$/, "");

  return {
    filePath,
    name: agentName ?? fallbackName,
  };
}

/** List entry for tools/agents directory scanning. */
export interface ComponentListEntry {
  name: string;       // filename without .ts extension
  filePath: string;   // absolute path
}

/**
 * List all tools in the tools directory.
 * Returns an empty array if the directory doesn't exist.
 */
export async function listTools(config: KitnConfig, cwd: string): Promise<ComponentListEntry[]> {
  const dir = toolsDir(config, cwd);
  return listComponentsInDir(dir);
}

/**
 * List all agents in the agents directory.
 * Returns an empty array if the directory doesn't exist.
 */
export async function listAgents(config: KitnConfig, cwd: string): Promise<ComponentListEntry[]> {
  const dir = agentsDir(config, cwd);
  return listComponentsInDir(dir);
}

/** Scan a directory for .ts files and return component list entries. */
async function listComponentsInDir(dir: string): Promise<ComponentListEntry[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
      .sort()
      .map((f) => ({
        name: f.replace(/\.ts$/, ""),
        filePath: join(dir, f),
      }));
  } catch {
    return [];
  }
}
