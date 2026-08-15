import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.courrier.app',
  appName: 'Courrier',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: { allowMixedContent: false, captureInput: true },
};

export default config;
