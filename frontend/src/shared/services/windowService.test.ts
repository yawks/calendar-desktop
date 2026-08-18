import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDesktopContext, openAppWindow } from './windowService';

describe('windowService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens and reuses a named browser window on desktop', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const focus = vi.fn();
    const open = vi.fn(() => ({ focus }));
    vi.stubGlobal('open', open);
    expect(isDesktopContext()).toBe(true);
    await openAppWindow('/calendar', 'courrier-calendar');
    expect(open).toHaveBeenCalledWith('/calendar', 'courrier-calendar', 'popup,width=1200,height=800');
    expect(focus).toHaveBeenCalled();
  });

  it('delegates application windows to Tauri', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('__TAURI__', { core: { invoke } });

    await openAppWindow('/calendar', 'courrier-calendar', 'Calendrier');

    expect(invoke).toHaveBeenCalledWith('open_app_window', {
      label: 'calendar', path: '/calendar', title: 'Calendrier',
    });
  });

  it('uses the always-injected Tauri runtime when the optional global API is disabled', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });

    await openAppWindow('/calendar', 'courrier-calendar', 'Calendrier');

    expect(invoke).toHaveBeenCalledWith('open_app_window', {
      label: 'calendar', path: '/calendar', title: 'Calendrier',
    });
  });
});
