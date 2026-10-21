// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ThreadDetail, type ThreadDetailProps } from './ThreadDetail';
import type { MailMessage, MailThread } from '../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./MessageBlock', () => ({ MessageBlock: () => null }));
vi.mock('./MailComposer', () => ({ MailComposer: () => null }));
vi.mock('./CollapsedMessagesBar', () => ({ CollapsedMessagesBar: () => null }));
vi.mock('./FolderPickerPopover', () => ({ FolderPickerPopover: () => null }));

it('retries automatic marking on reopening after another read conversation, while preserving manual unread in the open view', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement('div'));
  const onMarkRead = vi.fn();
  const props = {
    messagesLoading: false, replyingTo: null, contacts: [], moveFolders: [],
    supportsSnooze: false, onMarkRead,
  } as unknown as ThreadDetailProps;
  const render = async (conversationId: string, read: boolean, accountId = 'account', messagesFetching = false) => {
    const thread = { conversation_id: conversationId, accountId, topic: 'Mail', unread_count: read ? 0 : 1 } as MailThread;
    const message = { item_id: conversationId, is_read: read, subject: 'Mail', date_time_received: '', attachments: [] } as unknown as MailMessage;
    await act(async () => root.render(<ThreadDetail {...props} thread={thread} messages={[message]} messagesFetching={messagesFetching} />));
  };
  try {
    await render('first', false, 'account', true);
    expect(onMarkRead).not.toHaveBeenCalled();
    await render('first', false);
    expect(onMarkRead).toHaveBeenCalledTimes(1);
    await render('first', true);
    await render('first', false);
    expect(onMarkRead).toHaveBeenCalledTimes(1);
    await render('second', true);
    await render('first', false);
    expect(onMarkRead).toHaveBeenCalledTimes(2);
    await render('first', false, 'other-account');
    expect(onMarkRead).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
  }
});
