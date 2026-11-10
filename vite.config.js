import { defineConfig } from 'vite';
import { setupRealtime } from './server/realtime.js';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  plugins: [
    {
      name: 'realtime-plugin',
      configureServer(server) {
        if (server.httpServer) {
          setupRealtime(server.httpServer);
        }
      },
      configurePreviewServer(server) {
        if (server.httpServer) {
          setupRealtime(server.httpServer);
        }
      }
    }
  ]
});
