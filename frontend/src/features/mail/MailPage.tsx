import { Mail, X } from 'lucide-react';
import { useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MailSidebar } from './components/MailSidebar';
import { ThreadList } from './components/thread/ThreadList';
import { ThreadDetail } from './components/thread/ThreadDetail';
import { NewMessageComposer } from './components/composer/NewMessageComposer';
import { useMailState } from './hooks/useMailState';
import { useMailProviders } from './hooks/useMailProviders';
import { useMailLogic } from './hooks/useMailLogic';
import { useMailActions } from './hooks/useMailActions';
import { useMailDeletion } from './hooks/useMailDeletion';
import { useMailSnooze } from './hooks/useMailSnooze';
import { useMailFolders } from './hooks/useMailFolders';
import { useMailToasts } from './hooks/useMailToasts';
import { useGoogleAuth } from '../../store/GoogleAuthStore';
import { useExchangeAuth } from '../../store/ExchangeAuthStore';

export default function MailPage() {
  const { t } = useTranslation();
  const folderAccountedRef = useRef<Set<string>>(new Set());
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const { accounts: googleAccounts } = useGoogleAuth();
  const { accounts: exchangeAccounts } = useExchangeAuth();

  const allMailAccounts = useMemo(() => {
    const g = googleAccounts.map(a => ({ id: a.id, email: a.email, name: a.name || '', providerType: 'gmail' as const, color: (a as any).color }));
    const e = exchangeAccounts.map(a => ({ id: a.id, email: a.email, name: a.displayName || '', providerType: 'ews' as const, color: (a as any).color }));
    return [...g, ...e];
  }, [googleAccounts, exchangeAccounts]);

  // State management
  const state = useMailState(allMailAccounts);
  const {
    selectedAccountId, setSelectedAccountId,
    selectedFolder, setSelectedFolder,
    isAllMode,
    threads,
    threadsLoading,
    threadsLoadingMore,
    selectedThread, setSelectedThread,
    messages,
    messagesLoading,
    composing, setComposing,
    setSelectedThreadIds,
    folderUnreadCounts, setFolderUnreadCounts,

    error, setError,
    mailContacts,
    composingAccountId, setComposingAccountId,
    setComposingDraftItemId,
    composerRestoreData, setComposerRestoreData,
    toast,
  } = state;

  // Providers & Logic
  const { allProviders, provider, resolveProvider } = useMailProviders({ selectedAccountId });

  const { updateBadge } = useMailToasts({ setFolderUnreadCounts });

  const mailLogic = useMailLogic({
    ...state,
    allProviders,
    allMailAccounts,
    resolveProvider,
    provider,
    folderAccountedRef,
    updateBadge,
  });

  const { loadMoreThreads, openThread, silentRefresh, allModeDynamicFolders } = mailLogic;

  // Actions
  const { handleReply, handleForward, onSend, onSaveDraft, onDeleteDraft, downloadAttachment, getRawAttachmentData } = useMailActions({
    ...state,
    resolveProvider,
    provider,
    silentRefresh,
  });

  const { handleDelete, handleArchive, handleToggleRead } = useMailDeletion({
    ...state,
    resolveProvider,
    provider,
    silentRefresh,
  });

  const { handleSnooze } = useMailSnooze({
    setSelectedThread,
    silentRefresh,
    setError,
  });

  const { handleFolderSelect } = useMailFolders({
    setSelectedAccountId,
    setSelectedFolder,
    setSelectedThread,
    setMessages: state.setMessages,
    setReplyingTo: state.setReplyingTo,
  });

  // Render helpers
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 100) loadMoreThreads();
  };

  const handleThreadClick = (thread: any, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setSelectedThreadIds(prev => {
        const next = new Set(prev);
        if (next.has(thread.conversation_id)) next.delete(thread.conversation_id);
        else next.add(thread.conversation_id);
        return next;
      });
    } else {
      openThread(thread);
    }
  };

  const handleImageClick = useCallback((src: string) => {
    setPreviewImageUrl(src);
  }, []);

  const selectedAccount = allMailAccounts.find(a => a.id === (selectedThread?.accountId || selectedAccountId));
  const currentUserEmail = selectedAccount?.email;
  const mailProviderType = selectedAccount?.providerType === 'gmail' ? 'gmail' : (selectedAccount?.providerType === 'ews' ? 'ews' : undefined);

  return (
    <div className="mail-page">
      <MailSidebar
        selectedFolder={selectedFolder}
        onSelectFolder={(folderId) => handleFolderSelect(selectedAccountId, folderId)}
        onCompose={() => { setComposing(true); setComposerRestoreData(null); setComposingDraftItemId(null); }}
        provider={provider}
        folderUnreadCounts={folderUnreadCounts}
        overrideDynamicFolders={allModeDynamicFolders || undefined}
        selectedAccountId={selectedAccountId}
        allAccountFolders={state.allAccountFolders}
        allMailAccounts={allMailAccounts}
      />

      <div className="mail-main">
        <div className="mail-threads">
          <div className="mail-threads__header">
            <h1 className="mail-threads__title">
              {isAllMode ? t('mail.allAccounts', 'Toutes les boîtes') : (allMailAccounts.find(a => a.id === selectedAccountId)?.email)}
            </h1>
            <button className="btn-primary" onClick={() => { setComposing(true); setComposerRestoreData(null); setComposingDraftItemId(null); }} type="button">
              <Mail size={16} /> {t('mail.compose', 'Nouveau')}
            </button>
          </div>

          <ThreadList
            threads={threads}
            selectedThreadId={selectedThread?.conversation_id}
            selectedThreadIds={state.selectedThreadIds}
            onThreadClick={handleThreadClick}
            onScroll={handleScroll}
            loading={threadsLoading}
            loadingMore={threadsLoadingMore}
          />
        </div>

        <div className="mail-content">
          {composing ? (
            <NewMessageComposer
              contacts={mailContacts}
              restoreData={composerRestoreData}
              onSend={onSend}
              onCancel={() => setComposing(false)}
              onSaveDraft={onSaveDraft}
              onDeleteDraft={onDeleteDraft}
              fromAccounts={isAllMode ? allMailAccounts : undefined}
              fromAccountId={composingAccountId}
              onFromAccountChange={setComposingAccountId}
            />
          ) : selectedThread ? (
            <ThreadDetail
              thread={selectedThread}
              messages={messages}
              messagesLoading={messagesLoading}
              onReply={handleReply}
              onForward={handleForward}
              onArchive={handleArchive}
              onDelete={handleDelete}
              onSnooze={() => handleSnooze('tomorrow')}
              onMove={() => {}}
              onClose={() => state.setSelectedThread(null)}
              onImageClick={handleImageClick}
              onDownloadAttachment={downloadAttachment}
              onGetAttachmentData={getRawAttachmentData}
              onTrash={handleDelete}
              onToggleRead={handleToggleRead}
              currentUserEmail={currentUserEmail}
              mailProviderType={mailProviderType as any}
            />
          ) : (
            <div className="mail-content__empty">
              <Mail size={48} opacity={0.1} />
              <p>{t('mail.selectThread', 'Sélectionnez un message pour le lire')}</p>
            </div>
          )}
        </div>
      </div>

      {previewImageUrl && (
        <div className="mail-image-preview" onClick={() => setPreviewImageUrl(null)}>
          <div className="mail-image-preview__content">
            <img src={previewImageUrl} alt="Preview" />
            <button className="mail-image-preview__close" onClick={() => setPreviewImageUrl(null)} type="button">
              <X size={24} />
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="mail-toast">
          {toast.message}
          {toast.action && <button onClick={toast.action.onClick} type="button">{toast.action.label}</button>}
        </div>
      )}

      {error && (
        <div className="mail-error-banner">
          {error}
          <button onClick={() => setError(null)} type="button"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}
