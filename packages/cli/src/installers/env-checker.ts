import pc from "picocolors";

export function checkEnvVars(envVars: Record<string, string>): string[] {
  const missing: string[] = [];
  for (const [key, description] of Object.entries(envVars)) {
    if (!process.env[key]) {
      missing.push(`  ${pc.yellow(key)}: ${description}`);
    }
  }
  return missing;
}
