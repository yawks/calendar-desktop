import { useState } from 'react';
import { MailMessage, MailThread, MailFolder } from '../types';
import { RecipientEntry } from '../components/RecipientInput';
import { ComposerRestoreData } from '../composerTypes';

export function useMailState(allMailAccounts: any[]) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(() => allMailAccounts[0]?.id ?? '');
  const [selectedFolder, setSelectedFolder] = useState<string>('inbox');
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsLoadingMore, setThreadsLoadingMore] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MailMessage | null>(null);
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll' | 'forward'>('reply');
  const [composing, setComposing] = useState(false);
  const [composingAccountId, setComposingAccountId] = useState<string>(() => allMailAccounts[0]?.id ?? '');
  const [mailContacts, setMailContacts] = useState<RecipientEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [folderUnreadCounts, setFolderUnreadCounts] = useState<Record<string, number>>({});
  const [allAccountFolders, setAllAccountFolders] = useState<Map<string, MailFolder[]>>(new Map());
  const [toast, setToast] = useState<{ message: string; action?: { label: string; onClick: () => void } } | null>(null);

  const [composerRestoreData, setComposerRestoreData] = useState<ComposerRestoreData | null>(null);
  const [composingDraftItemId, setComposingDraftItemId] = useState<{ itemId: string; accountId: string } | null>(null);

  const [snoozedByItemId, setSnoozedByItemId] = useState<Record<string, string>>(() => {
    const stored: any[] = JSON.parse(localStorage.getItem('mail-snoozed-items') ?? '[]');
    const map: Record<string, string> = {};
    for (const item of stored) map[item.itemId] = item.snoozeUntil;
    return map;
  });

  const isAllMode = selectedAccountId === '__all__';

  return {
    selectedAccountId, setSelectedAccountId,
    selectedFolder, setSelectedFolder,
    threads, setThreads,
    threadsLoading, setThreadsLoading,
    threadsLoadingMore, setThreadsLoadingMore,
    hasMoreThreads, setHasMoreThreads,
    selectedThread, setSelectedThread,
    messages, setMessages,
    messagesLoading, setMessagesLoading,
    replyingTo, setReplyingTo,
    replyMode, setReplyMode,
    composing, setComposing,
    composingAccountId, setComposingAccountId,
    mailContacts, setMailContacts,
    error, setError,
    selectedThreadIds, setSelectedThreadIds,
    folderUnreadCounts, setFolderUnreadCounts,
    allAccountFolders, setAllAccountFolders,
    toast, setToast,
    composerRestoreData, setComposerRestoreData,
    composingDraftItemId, setComposingDraftItemId,
    snoozedByItemId, setSnoozedByItemId,
    isAllMode,
  };
}
