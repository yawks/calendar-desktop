type BadgingNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export const appBadgeService = {
  async setCount(count: number): Promise<void> {
    if (count <= 0) return this.clear();
    await (navigator as BadgingNavigator).setAppBadge?.(count);
  },
  async clear(): Promise<void> {
    await (navigator as BadgingNavigator).clearAppBadge?.();
  },
};
