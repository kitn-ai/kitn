import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
    noExternal: ["@kitnai/cli-core"],
    esbuildOptions(options) {
      options.conditions = ["bun", "import"];
    },
  },
  {
    entry: ["src/http.ts"],
    format: ["esm"],
    dts: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
    noExternal: ["@kitnai/cli-core"],
    esbuildOptions(options) {
      options.conditions = ["bun", "import"];
    },
  },
]);
