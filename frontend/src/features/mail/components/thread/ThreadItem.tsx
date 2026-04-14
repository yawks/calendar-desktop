import { MailThread } from '../../types';
import { formatDate, initials, senderColor } from '../../utils';

interface ThreadItemProps {
  readonly thread: MailThread;
  readonly isSelected: boolean;
  readonly isMultiSelected: boolean;
  readonly onClick: (e: React.MouseEvent) => void;
}

export function ThreadItem({ thread, isSelected, isMultiSelected, onClick }: ThreadItemProps) {
  const isUnread = (thread.unread_count ?? 0) > 0;

  return (
    <div
      className={`mail-thread-item${isSelected ? ' mail-thread-item--selected' : ''}${isMultiSelected ? ' mail-thread-item--multiselected' : ''}${isUnread ? ' mail-thread-item--unread' : ''}`}
      onClick={onClick}
    >
      <div className="mail-thread-item__avatar" style={{ backgroundColor: senderColor(thread.from_name || thread.conversation_id, true) }}>
        {initials(thread.from_name || '')}
      </div>
      <div className="mail-thread-item__content">
        <div className="mail-thread-item__top">
          <span className="mail-thread-item__sender">{thread.from_name}</span>
          <span className="mail-thread-item__date">{formatDate(thread.last_delivery_time)}</span>
        </div>
        <div className="mail-thread-item__subject">{thread.subject || '(Sans objet)'}</div>
        <div className="mail-thread-item__preview">{thread.snippet}</div>
      </div>
    </div>
  );
}
