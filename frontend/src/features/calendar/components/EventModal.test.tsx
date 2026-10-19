// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import EventModal from './EventModal';
import i18n from '../../../i18n';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
const tagging = vi.hoisted(() => ({ setEventTag: vi.fn() }));
vi.mock('../store/TagStore', () => ({ useTags: () => ({ tags: [{ id: 'focus', name: 'Focus', color: '#123456' }], eventTags: {}, setEventTag: tagging.setEventTag, removeEventTag: vi.fn() }) }));
const calendar: CalendarConfig = { id: 'cal', name: 'Personal calendar', color: '#123456', url: '', visible: true, type: 'google' };
const event: CalendarEvent = { id: 'event', calendarId: 'cal', title: 'R&D planning', start: '2026-10-19T10:00:00Z', end: '2026-10-19T11:00:00Z', isAllday: false, category: 'time', location: 'Meeting room', description: 'Detailed description', selfRsvpStatus: 'NEEDS-ACTION', attendees: [{ email: 'guest@example.test', name: 'Guest', status: 'ACCEPTED' }] };
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
it.each([true, false])('respects explicit read-only mode without changing the calendar app default (readOnly=%s)', async readOnly => {
  const opener = document.createElement('button');
  const host = document.createElement('div');
  document.body.append(opener, host);
  opener.focus();
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EventModal event={event} calendar={calendar} readOnly={readOnly} onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCancelEvent={vi.fn()} onRsvp={vi.fn()} />));
    expect(host.querySelector('dialog')!.open).toBe(true);
    for (const text of ['R&D planning', 'Meeting room', 'Detailed description', 'Guest', 'Personal calendar']) expect(host.textContent).toContain(text);
    expect(!!host.querySelector('.event-modal-tag-button')).toBe(!readOnly);
    expect(!!host.querySelector('.lucide-pencil')).toBe(!readOnly);
    expect(!!host.querySelector(`[aria-label="${i18n.t('eventModal.delete')}"]`)).toBe(!readOnly);
    expect(!!host.querySelector('.rsvp-trigger-btn')).toBe(!readOnly);
  } finally {
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
    host.remove();
    opener.remove();
  }
});

it('allows tagging a read-only preview while protecting shared calendars', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EventModal event={event} calendar={calendar} readOnly allowTagEditing onClose={vi.fn()} onEdit={vi.fn()} />));
    expect(host.querySelector('.lucide-pencil')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('.event-modal-tag-button')!.click());
    const option = Array.from(host.querySelectorAll<HTMLButtonElement>('.event-modal-tag-dropdown button')).find(button => button.textContent === 'Focus')!;
    await act(async () => option.click());
    expect(tagging.setEventTag).toHaveBeenCalledWith('event', 'focus');
    await act(async () => root.render(<EventModal event={event} calendar={{ ...calendar, shared: { ownerEmail: 'other@example.test' } }} readOnly allowTagEditing onClose={vi.fn()} />));
    expect(host.querySelector('.event-modal-tag-button')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each([320, 480, 1024])('centers over the visible mail panel at %s px and follows its resize', async width => {
  const anchor = document.createElement('div');
  const host = document.createElement('div');
  document.body.append(anchor, host);
  const root = createRoot(host);
  let resized = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', 800);
  const left = width === 1024 ? 600 : 0;
  const bounds = { left, right: width, top: 80, bottom: 1200 };
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => bounds as DOMRect);
  try {
    await act(async () => root.render(<EventModal event={event} calendar={calendar} readOnly anchorElement={anchor} onClose={vi.fn()} />));
    const dialog = host.querySelector('dialog')!;
    expect(dialog.style.left).toBe(`${(left + width) / 2}px`);
    expect(dialog.style.top).toBe('440px');
    bounds.left = 0;
    resized();
    expect(dialog.style.left).toBe(`${width / 2}px`);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    anchor.remove();
    vi.unstubAllGlobals();
  }
});
