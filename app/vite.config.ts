import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // 开发时将 /api 转发到本地后端（server/index.js，默认 8787）
      "/api": {
        target: process.env.VITE_API_PROXY || "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
