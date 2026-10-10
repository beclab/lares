import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, "entrance"),
  base: "/",
  plugins: [vue()],
  resolve: {
    alias: {
      "@olares/lares-core": resolve(here, "../core"),
    },
  },
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
  },
});
