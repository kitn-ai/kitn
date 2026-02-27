import * as p from "@clack/prompts";
import pc from "picocolors";
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
    p.log.message(`  Run: ${pc.cyan("npm i -g @kitnai/cli")}`);
  } else {
    s.stop(pc.green("You're on the latest version"));
  }

  p.outro("");
}
