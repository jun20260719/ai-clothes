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
    // 监听所有本地地址（0.0.0.0 + ::），使 localhost 和 127.0.0.1 均可访问
    host: true,
    proxy: {
      // 开发时将 /api 转发到本地后端（server/index.js，默认 8787）
      // 目标用 127.0.0.1 而非 localhost，避免 Node 将 localhost 解析到 ::1 导致代理连不上后端
      "/api": {
        target: process.env.VITE_API_PROXY || "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
