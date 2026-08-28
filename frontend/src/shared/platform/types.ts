export type NotificationPrivacy = 'generic' | 'sender' | 'sender-subject';
export type NativeNotificationPermission = 'granted' | 'denied' | 'default';
export type NativeProvider = 'imap' | 'gmail' | 'exchange' | 'jmap';
export type NativeSyncMode = 'disabled' | 'continuous' | 'periodic' | 'manual';

export interface NativeSyncAccount {
  accountId: string;
  provider: NativeProvider;
  email: string;
  displayName?: string;
  serverUrl?: string;
  serverUsername?: string;
  serverPassword?: string;
  syncIntervalMinutes?: number;
  syncMode?: NativeSyncMode;
  credentialRevision?: number;
  credentialsUpdatedAt?: number;
  credentials: Record<string, unknown>;
}

export interface NativeSyncStatus {
  state?: 'running' | 'success' | 'retrying' | 'error' | 'connecting' | 'listening' | 'syncing' | 'waiting-retry' | 'periodic-fallback' | 'authentication-error' | 'provider-unsupported';
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastErrorCode?: string;
  lastEventAt?: number;
  nextApproximateAt?: number;
  configuredMode?: NativeSyncMode;
  watchdogStale?: boolean;
}
export interface NativeCredentialUpdate { accountId: string; credentialRevision: number; credentialsUpdatedAt: number; credentials: Record<string, unknown> }
export interface NativeNotificationThread { subject?: string; sender?: string; snippet?: string; receivedAt?: string }

export interface NativePlatform {
  readonly isNativeAndroid: boolean;
  configureSync(account: NativeSyncAccount): Promise<void>;
  disableSync(accountId: string): Promise<void>;
  runSyncNow(accountId: string): Promise<void>;
  getSyncStatus(accountId: string): Promise<NativeSyncStatus>;
  setNotificationPrivacy(privacy: NotificationPrivacy): Promise<void>;
  setVaultLocked(locked: boolean): Promise<void>;
  requestNotificationPermission(): Promise<boolean>;
  notificationPermission(): Promise<NativeNotificationPermission>;
  setNotificationsEnabled(enabled: boolean): Promise<void>;
  cancelConversationNotifications(accountId: string, conversationId: string): Promise<void>;
  consumeNotificationUrl(): Promise<string | null>;
  revealNotificationView?(): Promise<void>;
  diagnosticEvent?(event: string): Promise<void>;
  setBadge(count: number): Promise<void>;
  biometricStatus(): Promise<{ available: boolean; enabled: boolean }>;
  enableBiometricUnlock(vaultKey: string): Promise<void>;
  unlockWithBiometrics(): Promise<string>;
  disableBiometricUnlock(): Promise<void>;
  mailCommand?<T>(command: string, args: Record<string, unknown>): Promise<T>;
  exchangeAuth?<T>(command: 'exchange_auth_device' | 'exchange_auth_token' | 'exchange_auth_refresh', args: Record<string, unknown>): Promise<T>;
  googleAuthorize?(options: { serverClientId: string; capabilities: ('calendar' | 'email')[] }): Promise<{ serverAuthCode: string }>;
  openExternalUrl?(url: string): Promise<void>;
  backgroundRestrictions?(): Promise<{ batteryOptimized: boolean; manufacturer: string }>;
  openBatterySettings?(): Promise<void>;
  credentialUpdates?(): Promise<NativeCredentialUpdate[]>;
  notificationThread?(accountId: string, conversationId: string): Promise<NativeNotificationThread | null>;
  scanConfigQr?(): Promise<string>;
}
