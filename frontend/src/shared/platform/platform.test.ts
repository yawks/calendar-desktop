import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));

describe('platform fallback', () => {
  it('keeps the web implementation when Android native is absent', async () => {
    const { platform } = await import('./index');
    expect(platform.isNativeAndroid).toBe(false);
    await expect(platform.disableSync('account')).resolves.toBeUndefined();
  });
});
