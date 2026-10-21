// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadList, type ThreadListProps } from './ThreadList';
import type { MailThread } from '../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./ThreadItem', () => ({ ThreadItem: ({ thread, animateArrival }: { thread: MailThread; animateArrival: boolean }) =>
  <div data-thread-id={thread.conversation_id} data-arriving={animateArrival} /> }));

const threads = (count: number): MailThread[] => Array.from({ length: count }, (_, index) => ({
  conversation_id: String(index), topic: 'Mail', snippet: '', last_delivery_time: '',
  message_count: 1, unread_count: 0, from_name: null, from_email: null, has_attachments: false,
}));

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let props: ThreadListProps;
const render = async (changes: Partial<ThreadListProps> = {}) => {
  props = { ...props, ...changes };
  await act(async () => root.render(<ThreadList {...props} />));
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  // The viewport is far from the bottom; no scroll or intersection event fires.
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(4000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  props = {
    threads: threads(50), loading: false, loadingMore: false, hasMore: true,
    onLoadMore: vi.fn(() => true), scrollResetKey: 'inbox', selectedId: null,
    snoozedMap: {}, isInSnoozedFolder: false, selectedThreadIds: new Set(), filter: 'all',
    onSelect: vi.fn(), onToggleRead: vi.fn(), onDelete: vi.fn(), onToggleSelect: vi.fn(),
    onSelectAll: vi.fn(), onClearSelection: vi.fn(), onFilterChange: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ThreadList pagination after removal', () => {
  it('loads the next page after a removal without scrolling, then stops when replenished', async () => {
    await render();
    expect(props.onLoadMore).not.toHaveBeenCalled();
    await render({ threads: threads(49) });
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    await render({ loadingMore: true, threads: threads(48) });
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    await render({ loadingMore: false, threads: threads(98) });
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not refill an exhausted folder or a newly selected smaller folder', async () => {
    await render();
    await render({ threads: threads(49), hasMore: false });
    expect(props.onLoadMore).not.toHaveBeenCalled();
    await render({ threads: threads(10), hasMore: true, scrollResetKey: 'archive' });
    expect(props.onLoadMore).not.toHaveBeenCalled();
  });

  it('retries a refused request when a background refresh finishes', async () => {
    const refused = vi.fn(() => false);
    await render({ onLoadMore: refused });
    await render({ threads: threads(49) });
    expect(refused).toHaveBeenCalledTimes(1);
    const accepted = vi.fn(() => true);
    await render({ onLoadMore: accepted });
    expect(accepted).toHaveBeenCalledTimes(1);
  });
});

describe('ThreadList incoming messages', () => {
  const datedThread = (id: string, day: number) => ({
    ...threads(1)[0], conversation_id: id, last_delivery_time: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`,
  });
  const arriving = () => [...host.querySelectorAll('[data-arriving="true"]')].map(row => row.getAttribute('data-thread-id'));

  it('highlights new deliveries without animating initial loading or older paginated threads', async () => {
    await render({ threads: [datedThread('existing', 10)] });
    expect(arriving()).toEqual([]);
    await render({ threads: [datedThread('existing', 10), datedThread('older', 9)] });
    expect(arriving()).toEqual([]);
    await render({ threads: [datedThread('new', 12), datedThread('existing', 11), datedThread('older', 9)] });
    expect(arriving()).toEqual(['new', 'existing']);
  });

  it('does not animate another folder or a delivery timestamp moving backwards', async () => {
    await render({ threads: [datedThread('existing', 10)] });
    await render({ threads: [datedThread('existing', 9)] });
    expect(arriving()).toEqual([]);
    await render({ scrollResetKey: 'archive', threads: [datedThread('archive', 12)] });
    expect(arriving()).toEqual([]);
  });
});


describe('ThreadList unread pagination', () => {
  it('continues through read-only pages until older unread mail is found', async () => {
    await render({ filter: 'unread', unreadCount: 1 });
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    await render({ loadingMore: true });
    expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    await render({ threads: threads(100), loadingMore: false });
    expect(props.onLoadMore).toHaveBeenCalledTimes(2);
    const rows = threads(101);
    rows[100].unread_count = 1;
    await render({ threads: rows });
    expect(props.onLoadMore).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('[data-thread-id]')).toHaveLength(1);
    expect(host.querySelector('[data-thread-id="100"]')).not.toBeNull();
  });

  it('stops at the last page even if the folder counter is stale', async () => {
    await render({ filter: 'unread', unreadCount: 1, hasMore: false });
    expect(props.onLoadMore).not.toHaveBeenCalled();
  });
});
