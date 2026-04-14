import { MailThread } from '../../types';
import { ThreadItem } from './ThreadItem';

interface ThreadListProps {
  readonly threads: MailThread[];
  readonly selectedThreadId?: string;
  readonly selectedThreadIds: Set<string>;
  readonly onThreadClick: (thread: MailThread, e: React.MouseEvent) => void;
  readonly onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  readonly loading: boolean;
  readonly loadingMore: boolean;
}

export function ThreadList({
  threads,
  selectedThreadId,
  selectedThreadIds,
  onThreadClick,
  onScroll,
  loading,
  loadingMore
}: ThreadListProps) {
  if (loading && threads.length === 0) {
    return <div className="mail-threads__loading">Chargement des conversations...</div>;
  }

  if (threads.length === 0) {
    return <div className="mail-threads__empty">Aucun message ici.</div>;
  }

  return (
    <div className="mail-threads__scroll" onScroll={onScroll}>
      {threads.map(t => (
        <ThreadItem
          key={t.conversation_id}
          thread={t}
          isSelected={t.conversation_id === selectedThreadId}
          isMultiSelected={selectedThreadIds.has(t.conversation_id)}
          onClick={(e) => onThreadClick(t, e)}
        />
      ))}
      {loadingMore && <div className="mail-threads__loading-more">Chargement de la suite...</div>}
    </div>
  );
}
