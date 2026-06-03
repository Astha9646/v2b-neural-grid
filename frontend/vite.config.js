import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isProduction = mode === "production";

  return {
    plugins: [react()],
    base: "/",
    publicDir: "public",
    build: {
      outDir: "dist",
      assetsDir: "assets",
      sourcemap: false,
      cssCodeSplit: true,
      modulePreload: true,
      chunkSizeWarningLimit: 650,
      minify: isProduction,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("three") || id.includes("@react-three")) return "three-viz";
              if (id.includes("leaflet")) return "map-viz";
              if (id.includes("recharts") || id.includes("d3-")) return "charts";
              if (id.includes("react-router")) return "vendor";
              if (id.includes("react-dom") || id.includes("react/")) return "vendor";
              if (id.includes("axios")) return "http";
            }
            return undefined;
          },
          assetFileNames: "assets/[name]-[hash][extname]",
          chunkFileNames: "assets/[name]-[hash].js",
          entryFileNames: "assets/[name]-[hash].js",
        },
      },
    },
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        "/api": {
          target: process.env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8001",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        "/ws": {
          target: process.env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8001",
          changeOrigin: true,
          ws: true,
        },
      },
    },
    preview: {
      port: 4173,
    },
  };
});
