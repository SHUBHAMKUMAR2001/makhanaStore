import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    /**
     * Proxy /api to the backend in development so the browser sees one origin.
     * That keeps the session cookie first-party — a cross-origin cookie needs
     * SameSite=None and Secure, which does not work over plain-HTTP localhost.
     */
    proxy: {
      '/api': {
        target: process.env['VITE_API_PROXY_TARGET'] ?? 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
//# sourceMappingURL=vite.config.js.map
