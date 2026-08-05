import { ALL_ACCOUNTS_ID, buildUnreadCounts } from './utils';
import {
  BarChart2,
  ChartNoAxesCombined,
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
import { useEffect, useRef, useState } from "react";

import AppViewMenu from '../../shared/components/AppViewMenu';
import { AttachmentPreviewModal } from "./components/AttachmentPreviewModal";
import { ComposerAttachment } from './providers/MailProvider';
import { Link } from 'react-router-dom';
import { MailComposerHandle } from './components/MailComposer';
import { MailSearchBar } from './components/MailSearchBar';
import { MailSidebar } from './components/MailSidebar';
import { MailStatsModal } from "./components/MailStatsModal";
import { MultiSelectionPanel } from "./components/MultiSelectionPanel";
import { ThreadDetail } from "./components/ThreadDetail";
import { ThreadList } from "./components/ThreadList";
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { useDockBadge } from './hooks/useDockBadge';
import { useMailPageLogic } from './hooks/useMailPageLogic';

export default function MailApp() {
  const {
    t, allMailAccounts, selectedAccountId, isAllMode, selectedFolder,
    threads, threadsLoading, threadsRefreshing, threadsLoadingMore, selectedThread,
    messages, messagesLoading, replyingTo, replyMode, composing, composingAccountId,
    contacts, contactBackfillStatus, error, deleteToast, downloadToast, actionToast,
    selectedThreadIds, composerRestoreData, composingDraftItemId, sidebarCollapsed,
    sidebarWidth, threadListWidth, snoozedMap, isInSnoozedFolder, isInSpamFolder, allFolders,
    allAccountFolders, folderUnreadCounts, allAccountsUnreadCounts, sidebarDynamicFolders, attachmentPreview, loadingAttachmentId,
    setSelectedAccountId, setSelectedFolder, setComposing, setComposingAccountId,
    setError, setDownloadToast, cancelDeletion, reloadThreads,
    openThread, markRead, toggleRead, moveToTrash, handleToggleThreadRead,
    handleDeleteThread, handleSnooze, handleUnsnooze, handleMove, handleBulkDelete,
    handleBulkSnooze, handleBulkMove, handleBulkToggleRead, previewAttachment,
    downloadAttachment, getRawAttachmentData, scheduleSend, handleSaveDraft,
    startResizingSidebar, startResizingThreadList, setSidebarCollapsed,
    setSelectedThreadIds, setAttachmentPreview, setReplyingTo, setReplyMode, setActionToast,
    setSelectedThread, threadSupportsSnooze, mailCapabilitiesByAccount, provider, composerProvider,
    searchQuery, searchResults, searchLoading, handleSearch,
    accountIdentities, loadMoreThreads, hasMoreThreads,
    draftConversationIds, dismissDraftForConversation,
    allProviders,
  } = useMailPageLogic();

  useDockBadge(allAccountsUnreadCounts);

  const threadListRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<MailComposerHandle>(null);
  const newMessageComposerRef = useRef<NewMessageComposerHandle>(null);

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

  // When a reply is opened, pre-select the identity whose email appears in To or Cc
  useEffect(() => {
    if (!replyingTo || accountIdentities.length === 0) return;
    const recipientEmails = new Set([
      ...replyingTo.to_recipients.map(r => r.email.toLowerCase()),
      ...(replyingTo.cc_recipients ?? []).map(r => r.email.toLowerCase()),
    ]);
    const match = accountIdentities.find(i => recipientEmails.has(i.email.toLowerCase()));
    if (match) setSelectedIdentityId(match.id);
  }, [replyingTo, accountIdentities]);

  // In all-mode, switching identity also switches the active composing account
  const handleIdentityChange = (id: string) => {
    setSelectedIdentityId(id);
    if (isAllMode) {
      const identity = accountIdentities.find(i => i.id === id);
      if (identity?.accountId) setComposingAccountId(identity.accountId);
    }
  };

  return (
    <div className="mail-app">
      <header className="header">
        <button
          className="btn-icon"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? t('mail.showSidebar', 'Show sidebar') : t('mail.hideSidebar', 'Hide sidebar')}
        >
          <Menu size={20} />
        </button>
        <AppViewMenu current="mail" />

        <div className="header-spacer" />
        <MailSearchBar activeQuery={searchQuery} onSearch={handleSearch} contacts={contacts} provider={provider} />
        <div className="header-spacer" />

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
                onClick={() => setSelectedAccountId(ALL_ACCOUNTS_ID)}
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
                  <>
                    <button
                      key={acc.id}
                      type="button"
                      className={`mail-account-tab${isSelected ? ' mail-account-tab--active' : ''}`}
                      onClick={() => setSelectedAccountId(acc.id)}
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
                    </>
                );
              })}
            </nav>
          )}
          {!sidebarCollapsed && (
            <>
              <div style={{ width: sidebarWidth, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <MailSidebar
                  selectedFolder={selectedFolder}
                  onSelectFolder={(folder) => {
                    if (searchQuery) handleSearch(null);
                    setSelectedFolder(folder);
                  }}
                  onCompose={() => {
                    setComposing(true);
                    setSelectedThread(null);
                    setComposingAccountId(isAllMode ? (allMailAccounts[0]?.id ?? '') : selectedAccountId);
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

          <div style={{ width: threadListWidth, height: '100%', position: 'relative', zIndex: 1 }}>
            <ThreadList
              ref={threadListRef}
              threads={searchQuery ? searchResults : threads}
              loading={searchQuery ? searchLoading : threadsLoading}
              loadingMore={searchQuery ? false : threadsLoadingMore}
              hasMore={!searchQuery && hasMoreThreads}
              onLoadMore={searchQuery ? undefined : loadMoreThreads}
              isSearchMode={!!searchQuery}
              selectedId={selectedThread?.conversation_id ?? null}
              snoozedMap={snoozedMap}
              isInSnoozedFolder={isInSnoozedFolder}
              isSentFolder={selectedFolder === 'sentitems'}
              draftConversationIds={draftConversationIds}
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
            />
          </div>
          <div
            className="mail-resize-handle"
            onMouseDown={startResizingThreadList}
            style={{ cursor: 'col-resize' }}
          />

          <div className="mail-detail-panel">
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
              const draft = messages[messages.length - 1];
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
                  onCancel={() => setSelectedThread(null)}
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
                messages={messages.filter(m => !m.is_draft)}
                messagesLoading={messagesLoading}
                replyingTo={replyingTo}
                contacts={contacts}
                provider={composerProvider}
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
                onTrash={moveToTrash}
                onPreviewAttachment={previewAttachment}
                onDownloadAttachment={downloadAttachment}
                loadingAttachmentId={loadingAttachmentId}
                onGetAttachmentData={getRawAttachmentData}
                onReply={(msg: MailMessage) => { setReplyMode('reply'); setReplyingTo(msg); }}
                onReplyAll={(msg: MailMessage) => { setReplyMode('replyAll'); setReplyingTo(msg); }}
                onForward={(msg: MailMessage) => { setReplyMode('forward'); setReplyingTo(msg); }}
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
                snoozeUntil={snoozedMap[selectedThread.conversation_id]}
                isInSnoozedFolder={isInSnoozedFolder}
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
          <button
            type="button"
            className="mail-download-toast__open"
            onClick={() => invoke('open_file_path', { path: downloadToast.path }).catch(e => setError(String(e)))}
          >
            Ouvrir
          </button>
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
