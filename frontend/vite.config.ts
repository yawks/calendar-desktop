import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';

const gitValue = (args: string[], fallback: string) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback; } catch { return fallback; } };
const appCommitId = process.env.VITE_APP_COMMIT_ID || gitValue(['rev-parse', '--short', 'HEAD'], 'unknown');
const appCommitDate = process.env.VITE_APP_COMMIT_DATE || gitValue(['log', '-1', '--format=%cI'], 'unknown');


export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { 'import.meta.env.VITE_APP_COMMIT_ID': JSON.stringify(appCommitId), 'import.meta.env.VITE_APP_COMMIT_DATE': JSON.stringify(appCommitDate) },
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
