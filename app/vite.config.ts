import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // 绝对路径基址：server（Express）会将 build 产物托管在根路径 `/`，
  // 使用绝对路径可保证前端路由（含深层路由如 /product/123）刷新时资源正确加载。
  // （相对路径 './' 在 SPA fallback 下深层路由会解析出错误资源路径 → 404）
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // 构建产物直接输出到后端 server/public，
  // 这样 server 启动后即可用 express.static 一体托管前端 + API（单进程部署）。
  // outDir 在 root 之外时 Vite 默认会清空该目录，保证每次都是最新构建。
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
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
