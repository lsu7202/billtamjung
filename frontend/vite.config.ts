import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발: /api → 백엔드(Cloud Run 프록시와 동일 오리진 전략, 01-상세설계 §5·8.1)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",   // localhost 금지 — IPv6(::1)로 풀리면 도커(clickclip 등) 0.0.0.0:8000이 가로챔
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
