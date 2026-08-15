import { Capacitor, registerPlugin } from '@capacitor/core';
import type { NativePlatform, NativeSyncAccount, NotificationPrivacy } from './types';

interface CourrierNativePlugin {
  configureSync(options: NativeSyncAccount): Promise<void>;
  disableSync(options: { accountId: string }): Promise<void>;
  setNotificationPrivacy(options: { privacy: NotificationPrivacy }): Promise<void>;
  setVaultLocked(options: { locked: boolean }): Promise<void>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  cancelConversationNotifications(options: { accountId: string; conversationId: string }): Promise<void>;
  setBadge(options: { count: number }): Promise<void>;
}

const plugin = registerPlugin<CourrierNativePlugin>('CourrierNative');

export const nativeAndroidPlatform: NativePlatform = {
  isNativeAndroid: Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  configureSync: account => plugin.configureSync(account),
  disableSync: accountId => plugin.disableSync({ accountId }),
  setNotificationPrivacy: privacy => plugin.setNotificationPrivacy({ privacy }),
  setVaultLocked: locked => plugin.setVaultLocked({ locked }),
  requestNotificationPermission: async () => (await plugin.requestNotificationPermission()).granted,
  cancelConversationNotifications: (accountId, conversationId) => plugin.cancelConversationNotifications({ accountId, conversationId }),
  setBadge: count => plugin.setBadge({ count }),
};
