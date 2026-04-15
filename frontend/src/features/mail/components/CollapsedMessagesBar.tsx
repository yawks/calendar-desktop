import { MailMessage } from '../types';
import { MoreHorizontal } from 'lucide-react';
import { useTheme } from '../../../shared/store/ThemeStore';
import { senderColor } from '../utils';

export interface CollapsedMessagesBarProps {
  readonly messages: MailMessage[];
  readonly onExpand: () => void;
}

export function CollapsedMessagesBar({ messages, onExpand }: CollapsedMessagesBarProps) {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';

  const senders = messages.map(m => m.from_name ?? m.from_email ?? '?');
  const uniqueSenders = senders.filter((s, i) => senders.indexOf(s) === i);

  return (
    <button type="button" className="mail-collapsed-bar" onClick={onExpand}>
      <MoreHorizontal size={14} className="mail-collapsed-bar__dots" />
      <span className="mail-collapsed-bar__senders">
        {uniqueSenders.map((name, i) => (
          <span key={name} style={{ color: senderColor(name, isDark), fontWeight: 700 }}>
            {name}{i < uniqueSenders.length - 1 ? ', ' : ''}
          </span>
        ))}
      </span>
      <span className="mail-collapsed-bar__count">
        {messages.length} message{messages.length > 1 ? 's' : ''} masqué{messages.length > 1 ? 's' : ''}
      </span>
    </button>
  );
}
