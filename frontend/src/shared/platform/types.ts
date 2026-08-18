export type NotificationPrivacy = 'generic' | 'sender' | 'sender-subject';
export type NativeNotificationPermission = 'granted' | 'denied' | 'default';
export type NativeProvider = 'imap' | 'gmail' | 'exchange' | 'jmap';

export interface NativeSyncAccount {
  accountId: string;
  provider: NativeProvider;
  email: string;
  displayName?: string;
  serverUrl?: string;
  serverUsername?: string;
  serverPassword?: string;
  syncIntervalMinutes?: number;
  credentials: Record<string, unknown>;
}

export interface NativePlatform {
  readonly isNativeAndroid: boolean;
  configureSync(account: NativeSyncAccount): Promise<void>;
  disableSync(accountId: string): Promise<void>;
  setNotificationPrivacy(privacy: NotificationPrivacy): Promise<void>;
  setVaultLocked(locked: boolean): Promise<void>;
  requestNotificationPermission(): Promise<boolean>;
  notificationPermission(): Promise<NativeNotificationPermission>;
  setNotificationsEnabled(enabled: boolean): Promise<void>;
  cancelConversationNotifications(accountId: string, conversationId: string): Promise<void>;
  setBadge(count: number): Promise<void>;
  biometricStatus(): Promise<{ available: boolean; enabled: boolean }>;
  enableBiometricUnlock(vaultKey: string): Promise<void>;
  unlockWithBiometrics(): Promise<string>;
  disableBiometricUnlock(): Promise<void>;
  mailCommand?<T>(command: string, args: Record<string, unknown>): Promise<T>;
  exchangeAuth?<T>(command: 'exchange_auth_device' | 'exchange_auth_token' | 'exchange_auth_refresh', args: Record<string, unknown>): Promise<T>;
  googleAuthorize?(options: { serverClientId: string; capabilities: ('calendar' | 'email')[] }): Promise<{ serverAuthCode: string }>;
  openExternalUrl?(url: string): Promise<void>;
}
