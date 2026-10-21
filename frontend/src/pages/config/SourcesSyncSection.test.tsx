// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SourcesSyncSection } from './SourcesSyncSection';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const restore = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../shared/security/VaultProvider', () => ({
  useVault: () => ({ restoreFromNextcloud: restore, configSyncSettings: null }),
}));
vi.mock('../../shared/store/LogoDevTokenStore', () => ({ useLogoDevToken: () => ({}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('restores without prior backup only after entering credentials and confirming replacement', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<SourcesSyncSection />));
  const button = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('settings.configSync.restore'))!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('settings.configSync.credentialsRequired');
  for (const [id, value] of Object.entries({
    'config-sync-url': 'https://cloud.example.com',
    'config-sync-user': 'user',
    'config-sync-password': 'password',
  })) {
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>('#' + id)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('settings.configSync.recoveryRequired');
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('#config-sync-recovery')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'recovery-key');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const confirm = vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('System dialogs unavailable'); });
  await act(async () => button.click());
  expect(restore).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('settings.configSync.restoreConfirm');
  const findButton = (key: string) => [...container.querySelectorAll('button')].find(button => button.textContent?.includes(key))!;
  await act(async () => findButton('config.cancel').click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(restore).not.toHaveBeenCalled();
  await act(async () => button.click());
  let rejectRestore!: (error: Error) => void;
  restore.mockImplementationOnce(() => new Promise((_, reject) => { rejectRestore = reject; }));
  await act(async () => findButton('settings.configSync.confirmRestore').click());
  expect(button.disabled).toBe(true);
  expect(container.querySelector('[role="status"]')?.textContent).toBe('settings.configSync.working');
  await act(async () => rejectRestore(new Error('Network error')));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('settings.configSync.operationError');
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  await act(async () => findButton('settings.configSync.confirmRestore').click());
  expect(container.querySelector('[role="status"]')?.textContent).toBe('settings.configSync.finished');
  expect(confirm).not.toHaveBeenCalled();
  expect(restore).toHaveBeenCalledWith({ serverUrl: 'https://cloud.example.com', username: 'user', password: 'password', recoveryKey: 'recovery-key' });
  await act(async () => root.unmount());
  confirm.mockRestore();
});
