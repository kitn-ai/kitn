import { access } from "fs/promises";
import { join } from "path";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

const LOCKFILE_MAP: [string, PackageManager][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

export async function detectPackageManager(dir: string): Promise<PackageManager | null> {
  for (const [lockfile, pm] of LOCKFILE_MAP) {
    try {
      await access(join(dir, lockfile));
      return pm;
    } catch {
      // lockfile doesn't exist, try next
    }
  }
  return null;
}

export function getInstallCommand(pm: PackageManager, packages: string[]): string {
  const pkgs = packages.join(" ");
  switch (pm) {
    case "bun":
      return `bun add ${pkgs}`;
    case "pnpm":
      return `pnpm add ${pkgs}`;
    case "yarn":
      return `yarn add ${pkgs}`;
    case "npm":
      return `npm install ${pkgs}`;
  }
}

export function getRunCommand(pm: PackageManager): string {
  switch (pm) {
    case "bun":
      return "bunx";
    case "pnpm":
      return "pnpm dlx";
    case "yarn":
      return "yarn dlx";
    case "npm":
      return "npx";
  }
}

/**
 * Detects which package manager was used to invoke the CLI globally.
 * Checks npm_config_user_agent first, falls back to process.env._, defaults to npm.
 */
export function detectCliInstaller(): PackageManager {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("bun/")) return "bun";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("npm/")) return "npm";

  const invoker = process.env._ ?? "";
  if (invoker.includes("bun")) return "bun";
  if (invoker.includes("pnpm")) return "pnpm";
  if (invoker.includes("yarn")) return "yarn";

  return "npm";
}

export function getGlobalInstallCommand(pm: PackageManager, pkg: string): string {
  switch (pm) {
    case "bun":
      return `bun install -g ${pkg}`;
    case "pnpm":
      return `pnpm add -g ${pkg}`;
    case "yarn":
      return `yarn global add ${pkg}`;
    case "npm":
      return `npm install -g ${pkg}`;
  }
}
