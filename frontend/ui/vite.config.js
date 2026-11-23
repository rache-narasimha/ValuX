import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL("./workspace.js", import.meta.url)),
      name: "ValuxUI",
      formats: ["iife"],
      fileName: () => "assignment-filters.js",
    },
    outDir: "../assets/built",
    emptyOutDir: true,
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  resolve: {
    alias: { vue: "vue/dist/vue.runtime.esm-bundler.js" },
  },
});
