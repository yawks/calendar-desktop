import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.courrier.app',
  appName: 'Courrier',
  webDir: 'dist',
  bundledWebRuntime: false,
  loggingBehavior: 'none',
  android: {
    allowMixedContent: false,
    captureInput: true,
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: { CapacitorHttp: { enabled: true } },
};

export default config;
