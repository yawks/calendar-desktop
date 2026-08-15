import type { NativePlatform } from './types';

export const webPlatform: NativePlatform = {
  isNativeAndroid: false,
  configureSync: async () => undefined,
  disableSync: async () => undefined,
  setNotificationPrivacy: async () => undefined,
  setVaultLocked: async () => undefined,
  requestNotificationPermission: async () => {
    if (!('Notification' in globalThis)) return false;
    return (await Notification.requestPermission()) === 'granted';
  },
  cancelConversationNotifications: async () => undefined,
  setBadge: async count => {
    const value = navigator as Navigator & { setAppBadge?: (count: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (count > 0) await value.setAppBadge?.(count); else await value.clearAppBadge?.();
  },
};
