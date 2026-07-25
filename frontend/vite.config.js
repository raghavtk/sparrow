import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dedicated port — avoid Vite silently hopping to 5174+ when Vanik (or
    // another app) already owns 5173. On WSL, that fallback often opens the
    // wrong Windows/Cursor relay and looks like "the other project".
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // Disable buffering so SSE events stream through immediately
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["x-accel-buffering"] = "no";
          });
        },
      },
    },
  },
});
