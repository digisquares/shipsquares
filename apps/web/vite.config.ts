import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The SPA is served same-origin by the control plane (@fastify/static) in the
// bundle; in dev, proxy the API/auth to a locally-running control plane.
const proxy = {
  target: "http://localhost:3000",
  changeOrigin: true,
};

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/auth": proxy,
      "/api": { ...proxy, ws: true }, // ws: live logs/status ride /api/v1/ws in dev
      "/healthz": proxy,
      "/readyz": proxy,
      "/vcs": proxy, // GitHub App install/callback round-trip in dev
    },
  },
});
