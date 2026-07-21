import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발: /api → 백엔드(Cloud Run 프록시와 동일 오리진 전략, 01-상세설계 §5·8.1)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
