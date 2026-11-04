import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the API server so the web app and API share an origin.
export default defineConfig({
  plugins: [react()],
  base: process.env.GIST_WEB_BASE ?? "/",
  server: { port: 5173, proxy: { "/api": "http://localhost:8787" } },
});
