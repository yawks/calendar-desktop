import { afterEach, describe, expect, it, vi } from 'vitest';

import { appBadgeService } from './appBadge';

describe('appBadgeService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('delegates badge updates to the Tauri desktop command', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });

    await appBadgeService.setCount(7);
    await appBadgeService.clear();

    expect(invoke).toHaveBeenNthCalledWith(1, 'set_badge_count', { count: 7 });
    expect(invoke).toHaveBeenNthCalledWith(2, 'set_badge_count', { count: 0 });
  });

  it('uses the Web Badging API outside Tauri', async () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { setAppBadge, clearAppBadge });

    await appBadgeService.setCount(3);
    await appBadgeService.clear();

    expect(setAppBadge).toHaveBeenCalledWith(3);
    expect(clearAppBadge).toHaveBeenCalledOnce();
  });
});
