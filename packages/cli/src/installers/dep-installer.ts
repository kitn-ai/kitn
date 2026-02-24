import { execSync } from "child_process";
import type { PackageManager } from "../utils/detect.js";

export function installDependencies(pm: PackageManager, deps: string[], projectDir: string): void {
  if (deps.length === 0) return;
  const pkgs = deps.join(" ");
  const cmd = (() => {
    switch (pm) {
      case "bun": return `bun add ${pkgs}`;
      case "pnpm": return `pnpm add ${pkgs}`;
      case "yarn": return `yarn add ${pkgs}`;
      case "npm": return `npm install ${pkgs}`;
    }
  })();
  execSync(cmd, { cwd: projectDir, stdio: "pipe" });
}

export function installDevDependencies(pm: PackageManager, deps: string[], projectDir: string): void {
  if (deps.length === 0) return;
  const pkgs = deps.join(" ");
  const cmd = (() => {
    switch (pm) {
      case "bun": return `bun add -d ${pkgs}`;
      case "pnpm": return `pnpm add -D ${pkgs}`;
      case "yarn": return `yarn add -D ${pkgs}`;
      case "npm": return `npm install -D ${pkgs}`;
    }
  })();
  execSync(cmd, { cwd: projectDir, stdio: "pipe" });
}
