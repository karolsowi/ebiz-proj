import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        // This will transform your SVG to a React component
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
  server: {
    // Faster startup for development
    host: true,
    port: 5175,
    strictPort: true,
    proxy: {
      // Proxy API calls to backend
      '/api': {
        // 127.0.0.1 avoids Windows resolving localhost → ::1 while backend is IPv4-only
        target: process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  // Optimize build for faster development
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});
