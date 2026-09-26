import tailwindcss from "@tailwindcss/vite";
import netlify from "@netlify/vite-plugin-tanstack-start";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    ...tanstackStart({
      server: { entry: "server" },
      pages: [{ path: "/" }],
      prerender: {
        enabled: true,
        concurrency: 1,
        retryCount: 3,
        retryDelay: 1_000,
      },
    }),
    netlify(),
    react(),
    tailwindcss(),
  ],
});
