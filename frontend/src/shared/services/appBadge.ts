import { getTauriInvoke } from '../platform/tauriRuntime';

type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export const appBadgeService = {
  async setCount(count: number): Promise<void> {
    if (count <= 0) return this.clear();
    const invoke = getTauriInvoke();
    if (invoke) {
      await invoke('set_badge_count', { count });
      return;
    }
    await (navigator as BadgingNavigator).setAppBadge?.(count);
  },
  async clear(): Promise<void> {
    const invoke = getTauriInvoke();
    if (invoke) {
      await invoke('set_badge_count', { count: 0 });
      return;
    }
    await (navigator as BadgingNavigator).clearAppBadge?.();
  },
};
