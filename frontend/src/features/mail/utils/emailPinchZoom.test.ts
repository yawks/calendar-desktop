// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { installEmailPinchZoom } from './emailPinchZoom';

it.each([320, 480, 1024])('zooms at %ipx, caps upward movement at the header, reverses and cleans up', width => {
  document.body.innerHTML = '<div style="overflow-y:auto"><div class="mail-message-block"><div class="mail-message-block__header"></div><iframe></iframe></div></div>';
  const scroller = document.body.firstElementChild as HTMLElement;
  const header = document.querySelector<HTMLElement>('.mail-message-block__header')!;
  const frame = document.querySelector('iframe')!;
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<div>Message</div>';
  const root = doc.body.firstElementChild as HTMLElement;
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0, width } as DOMRect);
  vi.spyOn(header, 'getBoundingClientRect').mockImplementation(() => ({ top: 100 - scroller.scrollTop } as DOMRect));
  vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => ({
    left: -doc.documentElement.scrollLeft,
    top: Number(root.style.transform.match(/translateY\((-?[\d.]+)px\)/)?.[1] ?? 0),
  } as DOMRect));
  const resize = vi.fn();
  const cleanup = installEmailPinchZoom(frame, root, resize);
  const touch = (type: string, span: number, count = 2) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'touches', { value: count === 2 ? [{ clientX: 75 - span / 2, clientY: 150 }, { clientX: 75 + span / 2, clientY: 150 }] : [] });
    doc.dispatchEvent(event);
    return event;
  };
  expect(touch('touchstart', 100).defaultPrevented).toBe(true);
  touch('touchmove', 200);
  expect(root.style.transform).toBe('translateY(-50px) scale(2)');
  expect(doc.documentElement.scrollLeft).toBe(75);
  expect(scroller.scrollTop).toBe(100);
  touch('touchmove', 300);
  expect(root.style.transform).toBe('translateY(-300px) scale(3)');
  expect(doc.documentElement.scrollLeft).toBe(150);
  expect(scroller.scrollTop).toBe(100);
  touch('touchend', 0, 0);
  touch('touchstart', 300);
  touch('touchmove', 200);
  expect(scroller.scrollTop).toBe(50);
  touch('touchmove', 20);
  expect(root.style.transform).toBe('scale(1)');
  expect(scroller.scrollTop).toBe(0);
  cleanup();
  const calls = resize.mock.calls.length;
  touch('touchstart', 100);
  touch('touchmove', 200);
  expect(resize).toHaveBeenCalledTimes(calls);
  document.body.replaceChildren();
});
