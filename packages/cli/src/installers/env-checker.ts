import pc from "picocolors";
import type { EnvVarConfig } from "../registry/schema.js";

export function checkEnvVars(envVars: Record<string, EnvVarConfig>): string[] {
  const missing: string[] = [];
  for (const [key, config] of Object.entries(envVars)) {
    if (!process.env[key]) {
      const parts = [`  ${pc.yellow(key)}: ${config.description}`];
      if (config.url) parts.push(pc.dim(` → ${config.url}`));
      missing.push(parts.join(""));
    }
  }
  return missing;
}
