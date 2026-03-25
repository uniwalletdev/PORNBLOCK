import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.VITE_API_URL || "http://localhost:3000";

  return {
  plugins: [react()],
  base: "/",
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: apiUrl,
        changeOrigin: true,
        // Strip the /api prefix — backend routes start at /auth, /devices, etc.
        rewrite: (path) => path.replace(/^\/api/, ""),
        // Allow proxying to HTTPS backends with self-signed certs in local dev.
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react:  ["react", "react-dom"],
          router: ["react-router-dom"],
          query:  ["@tanstack/react-query"],
        },
      },
    },
  },
  };
});
