function stripJsonc(text: string): string {
  return text
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*([}\]])/g, "$1");
}

export function patchTsconfig(
  tsconfigContent: string,
  paths: Record<string, string[]>,
  removePrefixes?: string[],
): string {
  const config = JSON.parse(stripJsonc(tsconfigContent));
  if (!config.compilerOptions) {
    config.compilerOptions = {};
  }
  if (!config.compilerOptions.paths) {
    config.compilerOptions.paths = {};
  }
  if (removePrefixes) {
    for (const key of Object.keys(config.compilerOptions.paths)) {
      if (removePrefixes.some((prefix) => key.startsWith(prefix))) {
        delete config.compilerOptions.paths[key];
      }
    }
  }
  for (const [key, value] of Object.entries(paths)) {
    config.compilerOptions.paths[key] = value;
  }
  const ES_TARGETS = ["es3", "es5", "es6", "es2015", "es2016", "es2017", "es2018", "es2019", "es2020", "es2021"];
  const currentTarget = (config.compilerOptions.target ?? "").toLowerCase();
  if (!currentTarget || ES_TARGETS.includes(currentTarget)) {
    config.compilerOptions.target = "ES2022";
  }
  if (!config.compilerOptions.moduleResolution) {
    config.compilerOptions.moduleResolution = "bundler";
  }
  if (!config.compilerOptions.module) {
    config.compilerOptions.module = "ESNext";
  }
  if (config.compilerOptions.skipLibCheck === undefined) {
    config.compilerOptions.skipLibCheck = true;
  }
  return JSON.stringify(config, null, 2) + "\n";
}
