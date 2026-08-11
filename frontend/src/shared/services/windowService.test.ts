import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDesktopContext, openAppWindow } from './windowService';

describe('windowService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens and reuses a named browser window on desktop', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const focus = vi.fn();
    const open = vi.fn(() => ({ focus }));
    vi.stubGlobal('open', open);
    expect(isDesktopContext()).toBe(true);
    openAppWindow('/calendar', 'courrier-calendar');
    expect(open).toHaveBeenCalledWith('/calendar', 'courrier-calendar', 'popup,width=1200,height=800');
    expect(focus).toHaveBeenCalled();
  });
});
