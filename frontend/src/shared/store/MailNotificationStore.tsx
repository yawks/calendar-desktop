import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { platform } from '../platform';

export interface MailNotificationSettings { enabled: boolean; }
type NotificationPermissionState = NotificationPermission | 'unsupported';
const STORAGE_KEY = 'courrier-mail-notifications-v1';
const MailNotificationContext = createContext<{
  settings: MailNotificationSettings;
  supported: boolean;
  permission: NotificationPermissionState;
  enable(): Promise<boolean>;
  disable(): void;
} | null>(null);

const webNotificationSupported = () => 'Notification' in globalThis;
const notificationSupported = () => platform.isNativeAndroid || webNotificationSupported();
const savedSettings = (): MailNotificationSettings => {
  try { return { enabled: JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{"enabled":false}').enabled === true }; }
  catch { return { enabled: false }; }
};

export function MailNotificationProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(savedSettings);
  const supported = notificationSupported();
  const [permission, setPermission] = useState<NotificationPermissionState>(() => {
    if (platform.isNativeAndroid) return 'default';
    return webNotificationSupported() ? Notification.permission : 'unsupported';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    if (platform.isNativeAndroid) void platform.setNotificationsEnabled(settings.enabled);
  }, [settings]);

  useEffect(() => {
    const refreshPermission = async () => {
      if (platform.isNativeAndroid) {
        const nativePermission = await platform.notificationPermission();
        setPermission(nativePermission === 'denied' ? 'denied' : 'default');
      }
      else setPermission(webNotificationSupported() ? Notification.permission : 'unsupported');
    };
    void refreshPermission();
    globalThis.addEventListener('focus', refreshPermission);
    return () => globalThis.removeEventListener('focus', refreshPermission);
  }, []);

  const value = useMemo(() => ({
    settings,
    supported,
    permission,
    enable: async () => {
      if (!notificationSupported()) return false;
      const enabled = platform.isNativeAndroid
        ? await platform.requestNotificationPermission()
        : await Notification.requestPermission() === 'granted';
      setPermission(enabled ? (platform.isNativeAndroid ? 'default' : 'granted') : 'denied');
      setSettings({ enabled });
      return enabled;
    },
    disable: () => setSettings({ enabled: false }),
  }), [settings, supported, permission]);

  return <MailNotificationContext.Provider value={value}>{children}</MailNotificationContext.Provider>;
}

export function useMailNotificationsSettings() {
  const context = useContext(MailNotificationContext);
  if (!context) throw new Error('useMailNotificationsSettings must be used inside MailNotificationProvider');
  return context;
}
