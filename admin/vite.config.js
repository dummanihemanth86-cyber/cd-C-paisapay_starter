import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://127.0.0.1:4000';
const backendProxy = {
  target: backend,
  changeOrigin: true,
  // The browser talks to Vite on the same origin. Drop the browser Origin on
  // the server-to-server hop so the backend's CORS policy need not trust
  // arbitrary LAN hosts used to open this local admin page.
  configure(proxy) {
    proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': backendProxy,
      '/health': backendProxy,
      '/ready': backendProxy,
    },
  },
});
