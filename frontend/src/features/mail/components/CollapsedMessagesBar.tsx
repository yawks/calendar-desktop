import { MailMessage } from '../types';
import { MoreHorizontal } from 'lucide-react';

export interface CollapsedMessagesBarProps {
  readonly messages: MailMessage[];
  readonly onExpand: () => void;
}

export function CollapsedMessagesBar({ messages, onExpand }: CollapsedMessagesBarProps) {
  return (
    <div className="mail-collapsed-bar" onClick={onExpand} title="Afficher les messages masqués">
      <div className="mail-collapsed-bar__line" />
      <div className="mail-collapsed-bar__content">
        <MoreHorizontal size={16} />
        <span>{messages.length} messages masqués</span>
      </div>
      <div className="mail-collapsed-bar__line" />
    </div>
  );
}
