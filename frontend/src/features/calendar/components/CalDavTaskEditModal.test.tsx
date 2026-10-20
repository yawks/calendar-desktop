// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import CalDavTaskEditModal from './CalDavTaskEditModal';
import { reloadCalDavTask, updateCalDavTask } from '../utils/caldavTaskApi';
import i18n from '../../../i18n';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
vi.mock('../utils/caldavTaskApi', async importOriginal => ({ ...await importOriginal<typeof import('../utils/caldavTaskApi')>(), reloadCalDavTask: vi.fn(), updateCalDavTask: vi.fn() }));
const calendar: CalendarConfig = { id: 'cal', name: 'OpenTodo', type: 'nextcloud', url: 'https://calendar.test/dav/', visible: true, color: '#123456', readOnly: true };
const event: CalendarEvent = { id: 'task', calendarId: 'cal', title: 'Task: Original', start: '2026-10-22T00:00:00', end: '2026-10-23T00:00:00', isAllday: true, category: 'allday', isTask: true, readOnly: false,
  caldavTask: { uid: 'task', resourceUrl: `${calendar.url}project/custom.ics`, etag: '"v1"', title: 'Original', due: '2026-10-22', project: 'Project Alpha', categories: ['Urgent', 'Client'] } };
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
it.each(['fr', 'en'])('labels inputs, exposes busy/success states and displays server project/labels (%s)', async language => {
  await i18n.changeLanguage(language);
  let finish: () => void = () => {};
  vi.mocked(updateCalDavTask).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const saved = vi.fn(); const close = vi.fn();
  try {
    await act(async () => root.render(<CalDavTaskEditModal event={event} calendar={calendar} onSaved={saved} onClose={close} />));
    expect(host.textContent).toContain('Project Alpha'); expect(host.textContent).toContain('Urgent, Client');
    for (const input of host.querySelectorAll('input:not([type=checkbox]), textarea')) expect(host.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(host.querySelector<HTMLButtonElement>('[type=submit]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[type=text]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('.modal-header button')!.disabled).toBe(true);
    await act(async () => finish());
    expect(host.querySelector('[role=status]')!.textContent).toBe(i18n.t('caldavTask.saved'));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLElement>('.modal-header')!.style.background).toBe('rgb(18, 52, 86)');
    expect(close).not.toHaveBeenCalled();
    expect(host.querySelector('.caldav-task-editor__actions')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.modal-header button')!.click());
    expect(close).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it('keeps the draft after a conflict and discards it only after explicit reload', async () => {
  await i18n.changeLanguage('fr');
  vi.mocked(updateCalDavTask).mockRejectedValue({ detail: 'provider_http_412' });
  const latest = { ...event, caldavTask: { ...event.caldavTask!, etag: '"v2"', title: 'Remote version' } };
  vi.mocked(reloadCalDavTask).mockResolvedValue(latest);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CalDavTaskEditModal event={event} calendar={calendar} onSaved={vi.fn()} onClose={vi.fn()} />));
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(host.querySelector('[role=alert]')!.textContent).toBe(i18n.t('caldavTask.conflict'));
    expect(host.querySelector<HTMLInputElement>('input[type=text]')!.value).toBe('Original');
    expect(host.querySelector('[type=submit]')).toBeNull();
    expect(reloadCalDavTask).not.toHaveBeenCalled();
    const reload = Array.from(host.querySelectorAll('button')).find(button => button.textContent === i18n.t('caldavTask.reload'))!;
    await act(async () => reload.click());
    expect(host.querySelector<HTMLInputElement>('input[type=text]')!.value).toBe('Remote version');
    expect(host.querySelector('[role=alert]')).toBeNull();
    vi.mocked(updateCalDavTask).mockResolvedValue();
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(updateCalDavTask).toHaveBeenLastCalledWith(expect.objectContaining({ caldavTask: expect.objectContaining({ etag: '"v2"' }) }), calendar, expect.objectContaining({ title: 'Remote version' }));
  } finally { await act(async () => root.unmount()); host.remove(); }
});
