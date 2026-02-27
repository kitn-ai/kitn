import { execSync } from "child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { detectCliInstaller, getGlobalInstallCommand } from "../utils/detect.js";
import { fetchLatestVersion, isNewer } from "../utils/update-check.js";

export async function checkCommand(currentVersion: string) {
  p.intro(pc.bgCyan(pc.black(" kitn check ")));

  p.log.info(`kitn v${currentVersion}`);

  const s = p.spinner();
  s.start("Checking for updates...");

  const latest = await fetchLatestVersion();

  if (!latest) {
    s.stop(pc.yellow("Could not reach the npm registry"));
    p.outro("Try again later.");
    return;
  }

  if (isNewer(latest, currentVersion)) {
    s.stop(pc.yellow(`Update available: ${currentVersion} → ${latest}`));

    const pm = detectCliInstaller();
    const installCmd = getGlobalInstallCommand(pm, "@kitnai/cli");

    const shouldUpdate = await p.confirm({ message: "Update now?" });

    if (p.isCancel(shouldUpdate) || !shouldUpdate) {
      p.log.message(`  Run: ${pc.cyan(installCmd)}`);
    } else {
      const us = p.spinner();
      us.start("Updating...");
      try {
        execSync(installCmd, { stdio: "pipe" });
        us.stop(pc.green(`Updated to v${latest}`));
      } catch {
        us.stop(pc.red("Update failed"));
        p.log.message(`  Run manually: ${pc.cyan(installCmd)}`);
      }
    }
  } else {
    s.stop(pc.green("You're on the latest version"));
  }

  p.outro("");
}
