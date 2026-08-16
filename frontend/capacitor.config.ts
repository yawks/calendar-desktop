import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.courrier.app',
  appName: 'Courrier',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: { allowMixedContent: false, captureInput: true },
  plugins: { CapacitorHttp: { enabled: true } },
};

export default config;
