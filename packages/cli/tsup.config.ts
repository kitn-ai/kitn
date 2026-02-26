import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  splitting: false,
  sourcemap: true,
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
});
