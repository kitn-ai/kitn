import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: ["src/http.ts"],
    format: ["esm"],
    dts: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
