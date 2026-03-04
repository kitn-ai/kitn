import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5180,
    proxy: {
      "/api": "http://localhost:18800",
      "/health": "http://localhost:18800",
      "/ws": {
        target: "ws://localhost:18800",
        ws: true,
      },
    },
  },
});
