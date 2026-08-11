import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 6173,
    strictPort: true,
    watch: {
    },
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
