const DESKTOP_MEDIA = '(min-width: 768px) and (hover: hover) and (pointer: fine)';

export function isDesktopContext(): boolean {
  return globalThis.matchMedia?.(DESKTOP_MEDIA).matches ?? false;
}

export function openAppWindow(path: string, name: string): Window | null {
  if (!isDesktopContext()) {
    globalThis.location.assign(path);
    return null;
  }
  const child = globalThis.open(path, name, 'popup,width=1200,height=800');
  child?.focus();
  return child;
}
