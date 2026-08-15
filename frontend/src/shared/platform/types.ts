export type NotificationPrivacy = 'generic' | 'sender' | 'sender-subject';
export type NativeProvider = 'imap' | 'gmail' | 'exchange' | 'jmap';

export interface NativeSyncAccount {
  accountId: string;
  provider: NativeProvider;
  email: string;
  displayName?: string;
  serverUrl: string;
  credentials: Record<string, unknown>;
}

export interface NativePlatform {
  readonly isNativeAndroid: boolean;
  configureSync(account: NativeSyncAccount): Promise<void>;
  disableSync(accountId: string): Promise<void>;
  setNotificationPrivacy(privacy: NotificationPrivacy): Promise<void>;
  setVaultLocked(locked: boolean): Promise<void>;
  requestNotificationPermission(): Promise<boolean>;
  cancelConversationNotifications(accountId: string, conversationId: string): Promise<void>;
  setBadge(count: number): Promise<void>;
}
