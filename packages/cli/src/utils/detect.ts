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
