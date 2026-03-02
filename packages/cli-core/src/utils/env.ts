import type { EnvVarConfig } from "../types/registry.js";

export function collectEnvVars(
  items: Array<{ envVars?: Record<string, EnvVarConfig> }>
): Record<string, EnvVarConfig> {
  const merged: Record<string, EnvVarConfig> = {};
  for (const item of items) {
    if (item.envVars) {
      Object.assign(merged, item.envVars);
    }
  }
  return merged;
}
