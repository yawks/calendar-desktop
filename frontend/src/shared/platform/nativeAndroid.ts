import { Capacitor, registerPlugin } from '@capacitor/core';
import type { NativeCredentialUpdate, NativeNotificationPermission, NativeNotificationThread, NativePlatform, NativeSyncAccount, NativeSyncStatus, NotificationPrivacy } from './types';

interface CourrierNativePlugin {
  configureSync(options: NativeSyncAccount): Promise<void>;
  disableSync(options: { accountId: string }): Promise<void>;
  runSyncNow(options: { accountId: string }): Promise<void>;
  getSyncStatus(options: { accountId: string }): Promise<NativeSyncStatus>;
  setNotificationPrivacy(options: { privacy: NotificationPrivacy }): Promise<void>;
  setVaultLocked(options: { locked: boolean }): Promise<void>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  notificationPermission(): Promise<{ permission: NativeNotificationPermission }>;
  setNotificationsEnabled(options: { enabled: boolean }): Promise<void>;
  cancelConversationNotifications(options: { accountId: string; conversationId: string }): Promise<void>;
  consumeNotificationUrl(): Promise<{ url?: string }>;
  revealNotificationView(): Promise<void>;
  diagnosticEvent(options: { event: string }): Promise<void>;
  setBadge(options: { count: number }): Promise<void>;
  biometricStatus(): Promise<{ available: boolean; enabled: boolean }>;
  enableBiometricUnlock(options: { vaultKey: string }): Promise<void>;
  unlockWithBiometrics(): Promise<{ vaultKey: string }>;
  disableBiometricUnlock(): Promise<void>;
  mailCommand(options: { command: string; args: Record<string, unknown> }): Promise<{ value: unknown }>;
  exchangeAuth(options: { command: 'exchange_auth_device' | 'exchange_auth_token' | 'exchange_auth_refresh'; args: Record<string, unknown> }): Promise<{ value: unknown }>;
  googleAuthorize(options: { serverClientId: string; capabilities: ('calendar' | 'email')[] }): Promise<{ serverAuthCode: string }>;
  openExternalUrl(options: { url: string }): Promise<void>;
  backgroundRestrictions(): Promise<{ batteryOptimized: boolean; manufacturer: string }>;
  openBatterySettings(): Promise<void>;
  credentialUpdates(): Promise<{ updates: NativeCredentialUpdate[] }>;
  notificationThread(options: { accountId: string; conversationId: string }): Promise<{ thread?: NativeNotificationThread }>;
  scanConfigQr(): Promise<{ value: string }>;
}

const plugin = registerPlugin<CourrierNativePlugin>('CourrierNative');

export const nativeAndroidPlatform: NativePlatform = {
  isNativeAndroid: Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  configureSync: account => plugin.configureSync(account),
  disableSync: accountId => plugin.disableSync({ accountId }),
  runSyncNow: accountId => plugin.runSyncNow({ accountId }),
  getSyncStatus: accountId => plugin.getSyncStatus({ accountId }),
  setNotificationPrivacy: privacy => plugin.setNotificationPrivacy({ privacy }),
  setVaultLocked: locked => plugin.setVaultLocked({ locked }),
  requestNotificationPermission: async () => (await plugin.requestNotificationPermission()).granted,
  notificationPermission: async () => (await plugin.notificationPermission()).permission,
  setNotificationsEnabled: enabled => plugin.setNotificationsEnabled({ enabled }),
  cancelConversationNotifications: (accountId, conversationId) => plugin.cancelConversationNotifications({ accountId, conversationId }),
  consumeNotificationUrl: async () => (await plugin.consumeNotificationUrl()).url ?? null,
  revealNotificationView: () => plugin.revealNotificationView(),
  diagnosticEvent: event => plugin.diagnosticEvent({ event }),
  setBadge: count => plugin.setBadge({ count }),
  biometricStatus: () => plugin.biometricStatus(),
  enableBiometricUnlock: vaultKey => plugin.enableBiometricUnlock({ vaultKey }),
  unlockWithBiometrics: async () => (await plugin.unlockWithBiometrics()).vaultKey,
  disableBiometricUnlock: () => plugin.disableBiometricUnlock(),
  mailCommand: async <T>(command: string, args: Record<string, unknown>) => (await plugin.mailCommand({ command, args })).value as T,
  exchangeAuth: async <T>(command: 'exchange_auth_device' | 'exchange_auth_token' | 'exchange_auth_refresh', args: Record<string, unknown>) => (await plugin.exchangeAuth({ command, args })).value as T,
  googleAuthorize: options => plugin.googleAuthorize(options),
  openExternalUrl: url => plugin.openExternalUrl({ url }),
  backgroundRestrictions: () => plugin.backgroundRestrictions(),
  openBatterySettings: () => plugin.openBatterySettings(),
  credentialUpdates: async () => (await plugin.credentialUpdates()).updates,
  notificationThread: async (accountId, conversationId) => (await plugin.notificationThread({ accountId, conversationId })).thread ?? null,
  scanConfigQr: async () => (await plugin.scanConfigQr()).value,
};
