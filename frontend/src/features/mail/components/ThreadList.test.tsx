// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadList, type ThreadListProps } from './ThreadList';
import type { MailThread } from '../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./ThreadItem', () => ({ ThreadItem: () => <div /> }));

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
