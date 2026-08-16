import { ALL_ACCOUNTS_ID, buildUnreadCounts } from './utils';
import {
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Download,
  Inbox,
  Layers,
  Mail,
  Menu,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import { MailMessage, MailThread } from './types';
import { NewMessageComposer, NewMessageComposerHandle } from "./components/NewMessageComposer";
import { Fragment, useEffect, useRef, useState } from "react";

import AppViewMenu from '../../shared/components/AppViewMenu';
import { AttachmentPreviewModal } from "./components/AttachmentPreviewModal";
import { ComposerAttachment } from './providers/MailProvider';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MailComposerHandle } from './components/MailComposer';
import { MailSearchBar } from './components/MailSearchBar';
import { MailSidebar } from './components/MailSidebar';
import { MailStatsModal } from "./components/MailStatsModal";
import { MultiSelectionPanel } from "./components/MultiSelectionPanel";
import { DeleteMessageConfirmation } from "./components/DeleteMessageConfirmation";
import { ThreadDetail } from "./components/ThreadDetail";
import { ThreadList } from "./components/ThreadList";
import { createPortal } from 'react-dom';
import { useDockBadge } from './hooks/useDockBadge';
import { useMailPageLogic } from './hooks/useMailPageLogic';

import { useIncomingMailNotifications } from './hooks/useIncomingMailNotifications';
import { recordUserInitiatedUnread } from './utils/userInitiatedUnread';
import { platform } from '../../shared/platform';
export default function MailApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    t, allMailAccounts, selectedAccountId, isAllMode, selectedFolder,
    threads, threadsLoading, threadsRefreshing, threadsLoadingMore, threadTotalCount, selectedThread,
    messages, messagesLoading, replyingTo, replyMode, composing, composingAccountId,
    contacts, contactBackfillStatus, error, deleteToast, downloadToast, actionToast,
    selectedThreadIds, composerRestoreData, composingDraftItemId, sidebarCollapsed,
    sidebarWidth, threadListWidth, snoozedMap, isInSnoozedFolder, isInSpamFolder, allFolders,
    allAccountFolders, folderUnreadCounts, allAccountsUnreadCounts, sidebarDynamicFolders, attachmentPreview, loadingAttachmentId,
    selectAccount, selectFolder, setComposing, setComposingAccountId,
    setError, setDownloadToast, cancelDeletion, reloadThreads,
    openThread, markRead, toggleRead, moveToTrash, handleToggleThreadRead,
    handleDeleteThread, handleDeleteMessage, handleSnooze, handleUnsnooze, handleMove, handleBulkDelete,
    handleBulkSnooze, handleBulkMove, handleBulkToggleRead, previewAttachment,
    downloadAttachment, getRawAttachmentData, scheduleSend, handleSaveDraft,
    startResizingSidebar, startResizingThreadList, setSidebarCollapsed,
    setSelectedThreadIds, setAttachmentPreview, setReplyingTo, setReplyMode, setActionToast,
    setSelectedThread, threadSupportsSnooze, mailCapabilitiesByAccount, provider, composerProvider, resolveProvider,
    searchQuery, searchResults, searchLoading, handleSearch,
    accountIdentities, loadMoreThreads, hasMoreThreads,
    draftConversationIds, dismissDraftForConversation,
    allProviders,
  } = useMailPageLogic();

  useDockBadge(allAccountsUnreadCounts);

  useIncomingMailNotifications(allMailAccounts, allProviders);
  const threadListRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<MailComposerHandle>(null);
  const newMessageComposerRef = useRef<NewMessageComposerHandle>(null);
  const [canceledScheduledDraft, setCanceledScheduledDraft] = useState<MailMessage | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<MailMessage | null>(null);
  const [messageDeleting, setMessageDeleting] = useState(false);
  const mobileActionToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledNotificationActionRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (mobileActionToastTimerRef.current) clearTimeout(mobileActionToastTimerRef.current);
  }, []);

  const selectedThreadsSnapshot = () => threads.filter(thread => selectedThreadIds.has(thread.conversation_id));

  const groupThreadsByProvider = (selected: MailThread[]) => {
    const groups = new Map<string, { provider: NonNullable<ReturnType<typeof resolveProvider>>; ids: string[] }>();
    for (const thread of selected) {
      const accountId = thread.accountId ?? selectedAccountId;
      const mailProvider = resolveProvider(thread.accountId);
      if (!mailProvider) continue;
      const group = groups.get(accountId) ?? { provider: mailProvider, ids: [] };
      group.ids.push(thread.conversation_id);
      groups.set(accountId, group);
    }
    return groups;
  };

  const showMobileUndo = (label: string, undo: () => Promise<void>) => {
    if (!globalThis.matchMedia('(max-width: 700px)').matches) return;
    if (mobileActionToastTimerRef.current) clearTimeout(mobileActionToastTimerRef.current);
    const onCancel = () => {
      if (mobileActionToastTimerRef.current) clearTimeout(mobileActionToastTimerRef.current);
      setActionToast(null);
      void undo().finally(() => reloadThreads());
    };
    setActionToast({ label, onCancel });
    mobileActionToastTimerRef.current = setTimeout(() => setActionToast(null), 5000);
  };

  const undoMoveFor = async (selected: MailThread[], targetFolderId: string) => {
    await Promise.all([...groupThreadsByProvider(selected).values()].map(group =>
      group.provider.bulkMoveToFolder(group.ids, targetFolderId),
    ));
  };

  const handleMobileBulkDelete = () => {
    const selected = selectedThreadsSnapshot();
    const sourceFolder = selectedFolder;
    handleBulkDelete();
    if (sourceFolder === 'deleteditems') return;
    showMobileUndo(
      t('mail.bulkMovedToTrash', '{{count}} conversation(s) déplacée(s) vers la corbeille', { count: selected.length }),
      () => undoMoveFor(selected, sourceFolder),
    );
  };

  const handleMobileBulkMove = (targetFolderId: string) => {
    const selected = selectedThreadsSnapshot();
    const sourceFolder = selectedFolder;
    handleBulkMove(targetFolderId);
    showMobileUndo(
      t('mail.bulkMoved', '{{count}} conversation(s) déplacée(s)', { count: selected.length }),
      () => undoMoveFor(selected, sourceFolder),
    );
  };

  const handleMobileBulkSnooze = (until: string) => {
    const selected = selectedThreadsSnapshot();
    const sourceFolder = selectedFolder;
    handleBulkSnooze(until);
    showMobileUndo(
      t('mail.bulkSnoozed', '{{count}} conversation(s) mise(s) en attente', { count: selected.length }),
      async () => {
        const snoozed = JSON.parse(localStorage.getItem('mail-snoozed') ?? '{}');
        for (const thread of selected) delete snoozed[thread.conversation_id];
        localStorage.setItem('mail-snoozed', JSON.stringify(snoozed));
        await undoMoveFor(selected, sourceFolder);
      },
    );
  };

  const handleMobileBulkToggleRead = (read: boolean) => {
    const selected = selectedThreadsSnapshot();
    handleBulkToggleRead(read);
    showMobileUndo(
      read
        ? t('mail.bulkMarkedRead', '{{count}} conversation(s) marquée(s) comme lue(s)', { count: selected.length })
        : t('mail.bulkMarkedUnread', '{{count}} conversation(s) marquée(s) comme non lue(s)', { count: selected.length }),
      async () => {
        await Promise.all(selected.map(async thread => {
          const accountId = thread.accountId ?? selectedAccountId;
          const mailProvider = resolveProvider(thread.accountId);
          if (!mailProvider) return;
          const items = (await mailProvider.getThread(thread.conversation_id, false)).map(message => ({
            item_id: message.item_id,
            change_key: message.change_key,
            conversation_id: thread.conversation_id,
          }));
          if (thread.unread_count === 0) await mailProvider.markRead(items);
          else {
            recordUserInitiatedUnread(accountId, thread.conversation_id);
            await mailProvider.markUnread(items);
          }
        }));
      },
    );
  };

  const pushMobileScreen = (screen: 'detail' | 'composer') => {
    if (!globalThis.matchMedia('(max-width: 700px)').matches) return;
    if (globalThis.history.state?.mailScreen === screen) return;
    globalThis.history.pushState({ ...globalThis.history.state, mailScreen: screen }, '');
  };

  useEffect(() => {
    const handleBrowserBack = () => {
      if (!globalThis.matchMedia('(max-width: 700px)').matches) return;
      setSelectedThread(null);
      setComposing(false);
      setSelectedThreadIds(new Set());
      setReplyingTo(null);
    };
    globalThis.addEventListener('popstate', handleBrowserBack);
    return () => globalThis.removeEventListener('popstate', handleBrowserBack);
  }, [setComposing, setReplyingTo, setSelectedThread, setSelectedThreadIds]);

  const handleSelectThread = (thread: MailThread) => {
    if (newMessageComposerRef.current) {
      if (newMessageComposerRef.current.hasChanges()) {
        const data = newMessageComposerRef.current.getDraftData();
        handleSaveDraft(
          composing ? (composingAccountId || selectedAccountId) : selectedThread?.accountId,
          data.to, data.cc, data.bcc, data.subject, data.bodyHtml,
        );
        setActionToast({ label: t('mail.draftSaved', 'Brouillon enregistré') });
        setTimeout(() => setActionToast(null), 3000);
      }
      if (composing) setComposing(false);
    }
    if (replyingTo && composerRef.current) {
      // A locally restored draft already exists on the server, so selecting another
      // thread only dismisses it instead of creating a duplicate draft.
      if (composerRef.current.hasChanges() && !composerRestoreData?.draftItemId) {
        const data = composerRef.current.getDraftData();
        handleSaveDraft(selectedThread?.accountId, data.to, data.cc, data.bcc, data.subject, data.bodyHtml, selectedThread?.conversation_id);
        setActionToast({ label: t('mail.draftSaved', 'Brouillon enregistré') });
        setTimeout(() => setActionToast(null), 3000);
      }
      setReplyingTo(null);
    }
    pushMobileScreen('detail');
    openThread(thread);
  };

  const [statsOpen, setStatsOpen] = useState(false);

  // Identity selection state remains local to the component for UI control
  const [selectedIdentityId, setSelectedIdentityId] = useState('');

  // Sync selected identity when the identity list changes (account switch or initial load)
  useEffect(() => {
    const primary = accountIdentities.find(i => !i.mayDelete) ?? accountIdentities[0];
    setSelectedIdentityId(primary?.id ?? '');
  }, [accountIdentities]);

  // In all-mode, switching identity also switches the active composing account
  const handleIdentityChange = (id: string) => {
    setSelectedIdentityId(id);
    if (isAllMode) {
      const identity = accountIdentities.find(i => i.id === id);
      if (identity?.accountId) setComposingAccountId(identity.accountId);
    }
  };

  // Pre-select the identity matching the recipients of a message being replied to.
  // Called synchronously in the reply handlers (same batch as setReplyingTo) so that
  // MailComposer mounts with the correct identity and injects the right signature.
  const preselectIdentityForMsg = (msg: MailMessage) => {
    if (accountIdentities.length === 0) return;
    const recipientEmails = new Set([
      ...msg.to_recipients.map(r => r.email.toLowerCase()),
      ...(msg.cc_recipients ?? []).map(r => r.email.toLowerCase()),
    ]);
    const match = accountIdentities.find(i => recipientEmails.has(i.email.toLowerCase()));
    if (match) handleIdentityChange(match.id);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const accountId = params.get('account');
    const conversationId = params.get('conversation');
    const rawAction = params.get('action') ?? 'open';
    const action = ['open', 'reply', 'delete', 'archive'].includes(rawAction) ? rawAction : 'open';
    if (!accountId || !conversationId) {
      handledNotificationActionRef.current = null;
      return;
    }

    const actionKey = accountId + ':' + conversationId + ':' + action;
    if (handledNotificationActionRef.current === actionKey) return;
    if (selectedAccountId !== accountId) {
      selectAccount(accountId);
      return;
    }

    const thread = threads.find(item =>
      item.conversation_id === conversationId && (item.accountId ?? accountId) === accountId
    );
    if (!thread) return;

    if (selectedThread?.conversation_id !== conversationId) {
      pushMobileScreen('detail');
      openThread(thread);
      return;
    }

    if (action === 'reply') {
      if (messagesLoading) return;
      const lastMessage = messages.filter(message => !message.is_draft).slice(-1)[0];
      if (!lastMessage) return;
      handledNotificationActionRef.current = actionKey;
      preselectIdentityForMsg(lastMessage);
      setReplyMode('reply');
      setReplyingTo(lastMessage);
      pushMobileScreen('detail');
    } else {
      handledNotificationActionRef.current = actionKey;
      if (action === 'delete') {
        moveToTrash(conversationId);
      } else if (action === 'archive') {
        const archiveFolder = allFolders.find(folder => {
          const id = folder.folder_id.toLowerCase();
          const name = folder.display_name.toLowerCase();
          return id === 'archive' || name === 'archive' || name === 'archives';
        });
        void handleMove(archiveFolder?.folder_id ?? 'archive');
      }
    }

    void platform.cancelConversationNotifications(accountId, conversationId);
    navigate('/', { replace: true });
  }, [
    allFolders,
    handleMove,
    location.search,
    messages,
    messagesLoading,
    navigate,
    openThread,
    selectedAccountId,
    selectedThread?.conversation_id,
    selectAccount,
    setReplyMode,
    setReplyingTo,
    threads,
  ]);

  const displayedThreads = searchQuery ? searchResults : threads;
  const selectedThreadIndex = selectedThread
    ? displayedThreads.findIndex(thread => thread.conversation_id === selectedThread.conversation_id)
    : -1;
  const selectedFolderLabel = (() => {
    const staticLabels: Record<string, string> = {
      inbox: t('mail.inbox', 'Inbox'),
      drafts: t('mail.drafts', 'Drafts'),
      scheduled: t('mail.scheduled', 'Scheduled'),
      sentitems: t('mail.sent', 'Sent'),
      deleteditems: t('mail.trash', 'Trash'),
      snoozed: t('mail.snoozed', 'Snoozed'),
      spam: t('mail.spam', 'Spam'),
    };
    return staticLabels[selectedFolder]
      ?? allFolders.find(folder => folder.folder_id === selectedFolder)?.display_name
      ?? selectedFolder;
  })();
  const selectedFolderTotal = searchQuery ? displayedThreads.length : threadTotalCount;

  return (
    <div className={`mail-app${selectedThread ? ' mail-app--detail-open' : ''}`}>
      <header className="header">
        <button
          className="btn-icon"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? t('mail.showSidebar', 'Show sidebar') : t('mail.hideSidebar', 'Hide sidebar')}
        >
          <Menu size={20} />
        </button>
        <AppViewMenu current="mail" />

        <div className="header-spacer mail-header-push" />
        <MailSearchBar activeQuery={searchQuery} onSearch={handleSearch} contacts={contacts} provider={provider} />
        <div className="header-spacer mail-header-gap" />

        <button className="btn-icon" onClick={reloadThreads} disabled={threadsRefreshing}
          title={t('header.refresh', 'Refresh')}>
          <RefreshCw size={18} className={threadsRefreshing ? 'spin' : ''} />
        </button>
        <button className="btn-icon" onClick={() => setStatsOpen(true)} title={t('mail.stats.title', 'Statistiques mail')}>
          <ChartNoAxesCombined size={20} />
        </button>
        <Link to="/config" className="btn-config btn-config--icon-only">
          <Settings size={17} />
        </Link>
      </header>

      {error && (
        <div className="mail-error-banner">
          {error}
          <button className="btn-icon" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {allMailAccounts.length === 0 ? (
        <div className="mail-placeholder">
          <Mail size={64} strokeWidth={1} style={{ opacity: 0.2 }} />
          <p style={{ opacity: 0.5 }}>
            {t('mail.noAccount', 'No mail account configured. Add an Exchange or Google account in Settings.')}
          </p>
          <Link to="/config" className="btn-primary">{t('header.configureBtn')}</Link>
        </div>
      ) : (
        <div className="mail-body">
          {allMailAccounts.length > 1 && (
            <nav className="mail-account-tabs">
              <button
                type="button"
                className={`mail-account-tab${isAllMode ? ' mail-account-tab--active' : ''}`}
                onClick={() => selectAccount(ALL_ACCOUNTS_ID)}
                title={t('mail.allAccounts', 'All accounts')}
              >
                <span className="mail-account-tab__stripe" style={{ background: 'var(--text-muted)' }} />
                <span className="mail-account-tab__label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Layers size={13} />
                </span>
                {(allAccountsUnreadCounts['inbox'] ?? 0) > 0 && (
                  <span className="mail-account-tab__badge">
                    {Math.min(allAccountsUnreadCounts['inbox']!, 99)}
                  </span>
                )}
              </button>
              <div className="mail-account-tab__divider" />
              {allMailAccounts.map(acc => {
                const label = (() => {
                  const atIdx = acc.email.indexOf('@');
                  const domain = atIdx >= 0 ? acc.email.slice(atIdx + 1) : acc.email;
                  return domain.charAt(0).toUpperCase() + domain.slice(1);
                })();
                const isSelected = acc.id === selectedAccountId;
                const accInboxUnread = buildUnreadCounts(allAccountFolders.get(acc.id) ?? [])['inbox'] ?? 0;
                return (
                  <Fragment key={acc.id}>
                    <button
                      type="button"
                      className={`mail-account-tab${isSelected ? ' mail-account-tab--active' : ''}`}
                      onClick={() => selectAccount(acc.id)}
                      title={acc.email}
                      >
                      <span
                        className="mail-account-tab__stripe"
                        style={{ background: acc.color ?? 'var(--primary)' }}
                        />
                      <span className="mail-account-tab__label">{label}</span>
                      {accInboxUnread > 0 && (
                        <span className="mail-account-tab__badge">
                          {Math.min(accInboxUnread, 99)}
                        </span>
                      )}
                    </button>
                  <div className="mail-account-tab__divider" />
                  </Fragment>
                );
              })}
            </nav>
          )}
          {!sidebarCollapsed && (
            <>
              <div style={{ width: sidebarWidth, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {allMailAccounts.length > 1 && (
                  <div className="mail-mobile-account-picker">
                    <div className="mail-mobile-account-picker__title">{t('mail.accounts')}</div>
                    <button
                      type="button"
                      className={`mail-mobile-account${isAllMode ? ' active' : ''}`}
                      onClick={() => {
                        selectAccount(ALL_ACCOUNTS_ID);
                        setSidebarCollapsed(true);
                      }}
                    >
                      <Layers size={18} />
                      <span>{t('mail.allAccounts')}</span>
                      {(allAccountsUnreadCounts.inbox ?? 0) > 0 && (
                        <span className="mail-mobile-account__badge">{Math.min(allAccountsUnreadCounts.inbox!, 99)}</span>
                      )}
                    </button>
                    {allMailAccounts.map((account) => {
                      const unread = buildUnreadCounts(allAccountFolders.get(account.id) ?? []).inbox ?? 0;
                      return (
                        <button
                          key={account.id}
                          type="button"
                          className={`mail-mobile-account${selectedAccountId === account.id ? ' active' : ''}`}
                          onClick={() => {
                            selectAccount(account.id);
                            setSidebarCollapsed(true);
                          }}
                        >
                          <span className="mail-mobile-account__dot" style={{ background: account.color ?? 'var(--primary)' }} />
                          <span className="mail-mobile-account__email">{account.email}</span>
                          {unread > 0 && <span className="mail-mobile-account__badge">{Math.min(unread, 99)}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                <MailSidebar
                  selectedFolder={selectedFolder}
                  onSelectFolder={(folder, accountId) => {
                    if (searchQuery) handleSearch(null);
                    selectFolder(folder, accountId);
                    if (globalThis.matchMedia('(max-width: 700px)').matches) setSidebarCollapsed(true);
                  }}
                  onCompose={() => {
                    pushMobileScreen('composer');
                    setComposing(true);
                    setSelectedThread(null);
                    setComposingAccountId(isAllMode ? (allMailAccounts[0]?.id ?? '') : selectedAccountId);
                    if (globalThis.matchMedia('(max-width: 700px)').matches) setSidebarCollapsed(true);
                  }}
                  folderUnreadCounts={folderUnreadCounts}
                  dynamicFolders={sidebarDynamicFolders}
                  supportsScheduledSend={isAllMode
                    ? allMailAccounts.some(account => mailCapabilitiesByAccount.get(account.id)?.scheduledSend.supported)
                    : mailCapabilitiesByAccount.get(selectedAccountId)?.scheduledSend.supported === true}
                />
                {contactBackfillStatus.state !== 'idle' && (
                  <div style={{ padding: '6px 12px', fontSize: 11, opacity: 0.65 }} title={contactBackfillStatus.error}>
                    {contactBackfillStatus.state === 'running' && t('mail.contactSync.running', {
                      folder: contactBackfillStatus.folder === 'sentitems'
                        ? t('mail.contactSync.sentFolder')
                        : contactBackfillStatus.folder === 'inbox'
                          ? t('mail.contactSync.inboxFolder')
                          : contactBackfillStatus.folder,
                      scanned: contactBackfillStatus.scanned,
                      inserted: contactBackfillStatus.inserted,
                    })}
                    {contactBackfillStatus.state === 'complete' && t('mail.contactSync.complete')}
                    {contactBackfillStatus.state === 'error' && t('mail.contactSync.error')}
                  </div>
                )}
              </div>
              <div
                className="mail-resize-handle"
                onMouseDown={startResizingSidebar}
                style={{ cursor: 'col-resize' }}
              />
            </>
          )}

          <div className="mail-thread-list-panel" style={{ width: threadListWidth, height: '100%', position: 'relative', zIndex: 1 }}>
            <ThreadList
              ref={threadListRef}
              threads={searchQuery ? searchResults : threads}
              loading={searchQuery ? searchLoading : threadsLoading}
              loadingMore={searchQuery ? false : threadsLoadingMore}
              totalCount={searchQuery ? undefined : threadTotalCount}
              scrollResetKey={`${selectedAccountId}:${selectedFolder}:${searchQuery ? 'search' : 'threads'}`}
              hasMore={!searchQuery && hasMoreThreads}
              onLoadMore={searchQuery ? undefined : loadMoreThreads}
              onRefresh={searchQuery ? undefined : reloadThreads}
              refreshing={!searchQuery && threadsRefreshing}
              isSearchMode={!!searchQuery}
              selectedId={selectedThread?.conversation_id ?? null}
              snoozedMap={snoozedMap}
              isInSnoozedFolder={isInSnoozedFolder}
              isSentFolder={selectedFolder === 'sentitems'}
              isInScheduledFolder={selectedFolder === 'scheduled'}
              draftConversationIds={draftConversationIds}
              sourceColor={allMailAccounts.find(account => account.id === selectedAccountId)?.color}
              onSelect={handleSelectThread}
              onToggleRead={handleToggleThreadRead}
              onDelete={handleDeleteThread}
              selectedThreadIds={selectedThreadIds}
              onToggleSelect={(thread: MailThread, range?: MailThread[]) => {
                setSelectedThreadIds(prev => {
                  if (range) {
                    const next = new Set(prev);
                    range.forEach(t => next.add(t.conversation_id));
                    return next;
                  }
                  const next = new Set(prev);
                  if (next.has(thread.conversation_id)) next.delete(thread.conversation_id);
                  else next.add(thread.conversation_id);
                  return next;
                });
              }}
              onSelectAll={() => setSelectedThreadIds(new Set(threads.map(t => t.conversation_id)))}
              onClearSelection={() => setSelectedThreadIds(new Set())}
              provider={provider}
              resolveProvider={(thread) => resolveProvider(thread.accountId)}
            />
          </div>
          {selectedThreadIds.size > 0 && (
            <MultiSelectionPanel
              compact
              className="mail-mobile-selection-toolbar"
              threads={threads}
              selectedIds={selectedThreadIds}
              onClearSelection={() => setSelectedThreadIds(new Set())}
              onBulkDelete={handleMobileBulkDelete}
              onBulkArchive={() => {
                const selected = threads.find(thread => selectedThreadIds.has(thread.conversation_id));
                const folders = isAllMode ? (allAccountFolders.get(selected?.accountId ?? "") ?? []) : allFolders;
                const archiveFolderId = folders.find(folder => {
                  const name = folder.display_name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
                  return folder.folder_id.toLowerCase() === "archive" || name === "archive" || name === "archives";
                })?.folder_id;
                handleMobileBulkMove(archiveFolderId ?? "archive");
              }}
              onBulkSnooze={handleMobileBulkSnooze}
              onBulkMove={handleMobileBulkMove}
              onBulkToggleRead={handleMobileBulkToggleRead}
              moveFolders={isAllMode ? (allAccountFolders.get(threads.find(thread => selectedThreadIds.has(thread.conversation_id))?.accountId ?? "") ?? allFolders) : allFolders}
              supportsSnooze={threads.filter(thread => selectedThreadIds.has(thread.conversation_id)).every(thread => mailCapabilitiesByAccount.get(thread.accountId ?? selectedAccountId)?.snooze === true)}
            />
          )}
          <div
            className="mail-resize-handle"
            onMouseDown={startResizingThreadList}
            style={{ cursor: 'col-resize' }}
          />

          <div className={`mail-detail-panel${selectedThread || composing ? ' mail-detail-panel--open' : ''}`}>
            <div className="mail-mobile-detail-nav">
              <button
                type="button"
                className="mail-mobile-detail-nav__back"
                aria-label={t('mail.backToList')}
                onClick={() => {
                  if (globalThis.history.state?.mailScreen) globalThis.history.back();
                  else { setSelectedThread(null); setComposing(false); setSelectedThreadIds(new Set()); }
                }}
              >
                <ChevronLeft size={30} />
              </button>
              <div className="mail-mobile-detail-nav__position">
                <strong>{selectedFolderLabel}</strong>
                {selectedThreadIndex >= 0 && (
                  <span> · {selectedThreadIndex + 1} / {selectedFolderTotal}</span>
                )}
              </div>
              <div className="mail-mobile-detail-nav__arrows">
                <button
                  type="button"
                  aria-label={t('mail.previousMessage')}
                  disabled={selectedThreadIndex <= 0}
                  onClick={() => selectedThreadIndex > 0 && handleSelectThread(displayedThreads[selectedThreadIndex - 1])}
                >
                  <ChevronUp size={27} />
                </button>
                <button
                  type="button"
                  aria-label={t('mail.nextMessage')}
                  disabled={selectedThreadIndex < 0 || selectedThreadIndex >= displayedThreads.length - 1}
                  onClick={() => selectedThreadIndex >= 0 && selectedThreadIndex < displayedThreads.length - 1 && handleSelectThread(displayedThreads[selectedThreadIndex + 1])}
                >
                  <ChevronDown size={27} />
                </button>
              </div>
            </div>
            {!composing && selectedThreadIds.size > 0 ? (
              <MultiSelectionPanel
                threads={threads}
                selectedIds={selectedThreadIds}
                onClearSelection={() => setSelectedThreadIds(new Set())}
                onBulkDelete={handleBulkDelete}
                onBulkSnooze={handleBulkSnooze}
                onBulkMove={handleBulkMove}
                onBulkToggleRead={handleBulkToggleRead}
                moveFolders={
                  isAllMode
                    ? (allAccountFolders.get(threads.find(t => selectedThreadIds.has(t.conversation_id))?.accountId ?? '') ?? allFolders)
                    : allFolders
                }
                supportsSnooze={
                  selectedThreadIds.size > 0 && threads
                    .filter(thread => selectedThreadIds.has(thread.conversation_id))
                    .every(thread => mailCapabilitiesByAccount.get(thread.accountId ?? selectedAccountId)?.snooze === true)
                }
              />
            ) : composing ? (
              <NewMessageComposer
                ref={newMessageComposerRef}
                contacts={contacts}
                provider={composerProvider}
                restoreData={composerRestoreData}
                scheduledSend={mailCapabilitiesByAccount.get(composingAccountId || selectedAccountId)?.scheduledSend}
                onSend={(to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[], fromIdentityId, recipients, sendAt) =>
                  scheduleSend(to, cc, bcc, subject, body, {
                    isNewMessage: true,
                    toRecipients: recipients.to,
                    ccRecipients: recipients.cc,
                    bccRecipients: recipients.bcc,
                    subject,
                    body,
                    attachments: attachments,
                    showCc: cc.length > 0,
                    showBcc: bcc.length > 0,
                    replyingToMsg: null,
                    fromAccountId: composingAccountId || undefined,
                    fromIdentityId,
                  }, attachments, sendAt)
                }
                onCancel={() => { setComposing(false); }}
                onSaveDraft={(to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string) =>
                  handleSaveDraft(composingAccountId || selectedAccountId, to, cc, bcc, subject, bodyHtml)
                }
                onDeleteDraft={composingDraftItemId ? async () => {
                   setComposing(false);
                } : undefined}
                fromAccounts={isAllMode ? allMailAccounts as any : []}
                fromAccountId={composingAccountId}
                onFromAccountChange={setComposingAccountId}
                identities={accountIdentities}
                selectedIdentityId={selectedIdentityId}
                onIdentityChange={handleIdentityChange}
              />
            ) : selectedThread === null ? (
              <div className="mail-detail-empty">
                <Inbox size={48} strokeWidth={1} style={{ opacity: 0.2 }} />
                <p style={{ opacity: 0.4 }}>{t('mail.selectThread', 'Select a conversation')}</p>
              </div>
            ) : selectedFolder === 'drafts' && !messagesLoading && messages.length > 0 ? (() => {
              const listedDraft = messages[messages.length - 1];
              const draft = canceledScheduledDraft?.item_id === listedDraft.item_id
                ? { ...listedDraft, ...canceledScheduledDraft }
                : listedDraft;
              const draftAccountId = selectedThread.accountId ?? (isAllMode ? composingAccountId : selectedAccountId);
              return (
                <NewMessageComposer
                  key={selectedThread.conversation_id}
                  ref={newMessageComposerRef}
                  contacts={contacts}
                  provider={composerProvider}
                  restoreData={{
                    toRecipients: (draft.to_recipients ?? []).map(r => ({ email: r.email, name: r.name ?? undefined })),
                    ccRecipients: (draft.cc_recipients ?? []).map(r => ({ email: r.email, name: r.name ?? undefined })),
                    bccRecipients: [],
                    subject: draft.subject ?? '',
                    body: draft.body_html ?? '',
                    attachments: [],
                    showCc: (draft.cc_recipients ?? []).length > 0,
                    showBcc: false,
                    isNewMessage: true,
                    replyingToMsg: null,
                    fromAccountId: draftAccountId,
                    draftItemId: draft.item_id,
                  }}
                  scheduledSend={mailCapabilitiesByAccount.get(draftAccountId)?.scheduledSend}
                  onSend={(to, cc, bcc, subject, body, attachments, fromIdentityId, recipients, sendAt) =>
                    scheduleSend(to, cc, bcc, subject, body, {
                      isNewMessage: true,
                      toRecipients: recipients.to,
                      ccRecipients: recipients.cc,
                      bccRecipients: recipients.bcc,
                      subject,
                      body,
                      attachments,
                      showCc: cc.length > 0,
                      showBcc: bcc.length > 0,
                      replyingToMsg: null,
                      fromAccountId: draftAccountId,
                      fromIdentityId,
                      draftItemId: draft.item_id,
                    }, attachments, sendAt)
                  }
                  onCancel={() => { setCanceledScheduledDraft(null); setSelectedThread(null); }}
                  onSaveDraft={(to, cc, bcc, subject, bodyHtml) =>
                    handleSaveDraft(draftAccountId, to, cc, bcc, subject, bodyHtml)
                  }
                  onDeleteDraft={() => moveToTrash(selectedThread.conversation_id)}
                  fromAccounts={isAllMode ? allMailAccounts as any : []}
                  fromAccountId={draftAccountId}
                  onFromAccountChange={setComposingAccountId}
                  identities={accountIdentities}
                  selectedIdentityId={selectedIdentityId}
                  onIdentityChange={handleIdentityChange}
                />
              );
            })() : (
              <ThreadDetail
                thread={selectedThread}
                sourceLabel={isAllMode ? (() => {
                  const email = allMailAccounts.find(account => account.id === selectedThread.accountId)?.email;
                  if (!email) return undefined;
                  const atIndex = email.lastIndexOf('@');
                  return atIndex >= 0 ? email.slice(atIndex + 1) : email;
                })() : undefined}
                sourceColor={isAllMode
                  ? allMailAccounts.find(account => account.id === selectedThread.accountId)?.color
                  : undefined}
                messages={messages.filter(m => !m.is_draft)}
                messagesLoading={messagesLoading}
                replyingTo={replyingTo}
                contacts={contacts}
                provider={resolveProvider(selectedThread.accountId)}
                currentUserEmail={
                  isAllMode
                    ? allMailAccounts.find(a => a.id === selectedThread.accountId)?.email
                    : allMailAccounts.find(a => a.id === selectedAccountId)?.email
                }
                mailProviderType={
                  (isAllMode
                    ? allMailAccounts.find(a => a.id === selectedThread.accountId)?.providerType
                    : allMailAccounts.find(a => a.id === selectedAccountId)?.providerType) as any
                }
                onMarkRead={markRead}
                onTrash={setMessageToDelete}
                onPreviewAttachment={previewAttachment}
                onDownloadAttachment={downloadAttachment}
                loadingAttachmentId={loadingAttachmentId}
                onGetAttachmentData={getRawAttachmentData}
                onReply={(msg: MailMessage) => { preselectIdentityForMsg(msg); setReplyMode('reply'); setReplyingTo(msg); }}
                onReplyAll={(msg: MailMessage) => { preselectIdentityForMsg(msg); setReplyMode('replyAll'); setReplyingTo(msg); }}
                onForward={(msg: MailMessage) => { preselectIdentityForMsg(msg); setReplyMode('forward'); setReplyingTo(msg); }}
                onToggleRead={toggleRead}
                replyMode={replyMode}
                onCancelReply={() => {
                  setReplyingTo(null);
                  if (composerRestoreData?.isNewMessage === false) {
                    // Restored draft — dismiss so it doesn't reappear on this conversation.
                    dismissDraftForConversation(selectedThread.conversation_id);
                  }
                }}
                onSaveDraft={(to: string[], cc: string[], bcc: string[], subject: string, bodyHtml: string) =>
                  handleSaveDraft(selectedThread.accountId, to, cc, bcc, subject, bodyHtml, selectedThread.conversation_id)
                }
                onDeleteThread={() => handleDeleteThread(selectedThread)}
                onToggleThreadRead={() => handleToggleThreadRead(selectedThread)}
                identities={accountIdentities}
                selectedIdentityId={selectedIdentityId}
                onIdentityChange={handleIdentityChange}
                onSend={(to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[], fromIdentityId?: string) =>
                  scheduleSend(to, cc, bcc, subject, body, {
                    isNewMessage: false,
                    isForward: replyMode === 'forward',
                    toRecipients: to.map(email => ({ email })),
                    ccRecipients: cc.map(email => ({ email })),
                    bccRecipients: bcc.map(email => ({ email })),
                    subject,
                    body,
                    attachments,
                    showCc: cc.length > 0,
                    showBcc: bcc.length > 0,
                    replyingToMsg: replyingTo,
                    fromIdentityId,
                  }, attachments)
                }
                composerRestoreData={composerRestoreData}
                supportsSnooze={threadSupportsSnooze}
                onSnooze={handleSnooze}
                snoozeUntil={selectedThread.snoozed_until ?? snoozedMap[selectedThread.conversation_id]}
                isInSnoozedFolder={isInSnoozedFolder}
                isInScheduledFolder={selectedFolder === 'scheduled'}
                onScheduledSendCanceled={(message) => {
                  setCanceledScheduledDraft(message);
                  selectFolder('drafts', isAllMode ? selectedThread.accountId : undefined);
                }}
                onUnsnooze={handleUnsnooze}
                isInSpamFolder={isInSpamFolder}
                onMarkAsSpam={() => handleMove('spam')}
                moveFolders={
                  isAllMode
                    ? (allAccountFolders.get(selectedThread.accountId ?? '') ?? [])
                    : allFolders
                }
                onMove={handleMove}
                composerRef={composerRef}
              />
            )}
            {messageToDelete && createPortal(
              <DeleteMessageConfirmation
                permanent={selectedFolder === 'deleteditems'}
                deleting={messageDeleting}
                onCancel={() => { if (!messageDeleting) setMessageToDelete(null); }}
                onConfirm={() => {
                  setMessageDeleting(true);
                  void handleDeleteMessage(messageToDelete)
                    .then(() => setMessageToDelete(null))
                    .catch(() => undefined)
                    .finally(() => setMessageDeleting(false));
                }}
              />,
              document.body,
            )}
          </div>
        </div>
      )}

      {deleteToast && createPortal(
        <div className="mail-delete-toast">
          <span>{deleteToast.label}</span>
          <button className="mail-delete-toast__undo" onClick={cancelDeletion}>
            {t('mail.undo', 'Annuler')}
          </button>
        </div>,
        document.body
      )}

      {actionToast && createPortal(
        <div className="mail-delete-toast">
          <span>{actionToast.label}</span>
          {actionToast.onCancel && (
            <button className="mail-delete-toast__undo" onClick={actionToast.onCancel}>
              {t('mail.cancel', 'Cancel')}
            </button>
          )}
        </div>,
        document.body
      )}

      {downloadToast && createPortal(
        <div className="mail-download-toast">
          <Download size={13} />
          <span className="mail-download-toast__name">{downloadToast.name}</span>
          <button type="button" className="mail-download-toast__close" onClick={() => setDownloadToast(null)}>
            <X size={13} />
          </button>
        </div>,
        document.body
      )}

      {attachmentPreview && (
        <AttachmentPreviewModal
          attachment={attachmentPreview.attachment}
          loading={attachmentPreview.loading}
          data={attachmentPreview.data}
          onClose={() => setAttachmentPreview(null)}
        />
      )}

      <MailStatsModal
        isOpen={statsOpen}
        onClose={() => setStatsOpen(false)}
        allMailAccounts={allMailAccounts}
        allProviders={allProviders}
        accountIdentities={accountIdentities}
      />
    </div>
  );
}
