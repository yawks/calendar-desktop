import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
import { platform } from '.';
import { useLayout } from '../store/LayoutStore';
import { useTheme } from '../store/ThemeStore';
import { Archive, ChevronDown, ChevronLeft, ChevronUp, FolderInput, MoreHorizontal, Reply, Trash2 } from 'lucide-react';
import { ContactAvatar } from '../../features/mail/components/ContactAvatar';
import { formatDate, senderColor } from '../../features/mail/utils';
import { setNotificationOpening } from './notificationOpening';
import { queryClient } from '../queryClient';

type OpeningNotification = {
  url: string;
  subject?: string;
  sender?: string;
  snippet?: string;
  receivedAt?: string;
};

export function NativeDeepLinks() {
  const navigate = useNavigate();
  const { setActiveTab } = useLayout();
  const { resolved } = useTheme();
  const activeNotificationUrlRef = useRef<string | null>(null);
  const openingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enrichmentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openingNotification, setOpeningNotification] = useState<OpeningNotification | null>(null);
  const openDeepLink = useCallback((url: string) => {
    const deepLink = new URL(url);
    const match = /^\/account\/([^/]+)\/conversation\/([^/]+)$/.exec(deepLink.pathname);
    if (!match || deepLink.hostname !== 'mail') {
      console.warn('[notification-link] rejected malformed target');
      return;
    }
    // Android can deliver the same notification through the launch intent,
    // appUrlOpen and our retained native intent. Handle it only once until the
    // app leaves the foreground; otherwise a late retained intent can reopen a
    // conversation after the user has already navigated elsewhere.
    if (activeNotificationUrlRef.current === url) {
      console.info('[notification-link] ignored duplicate target');
      return;
    }
    activeNotificationUrlRef.current = url;
    if (enrichmentTimeoutRef.current) clearTimeout(enrichmentTimeoutRef.current);
    enrichmentTimeoutRef.current = null;
    setNotificationOpening(true);
    void queryClient.cancelQueries({ queryKey: ['contact-photo'] });
    setOpeningNotification({
      url,
      subject: deepLink.searchParams.get('subject') || undefined,
      sender: deepLink.searchParams.get('sender') || undefined,
      snippet: deepLink.searchParams.get('snippet') || undefined,
      receivedAt: deepLink.searchParams.get('receivedAt') || undefined,
    });
    void platform.diagnosticEvent?.('notification-skeleton-shown');
    // Android hides the WebView as soon as it receives a notification intent.
    // Reveal it only after React has committed and painted this cover, avoiding
    // a frame of the previously visible Inbox on both cold and warm launches.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      void platform.revealNotificationView?.();
    }));
    if (openingTimeoutRef.current) clearTimeout(openingTimeoutRef.current);
    openingTimeoutRef.current = setTimeout(() => {
      void platform.diagnosticEvent?.('notification-skeleton-timeout');
      setOpeningNotification(null);
      setNotificationOpening(false);
    }, 60_000);
    console.info('[notification-link] accepted target');
    const accountId = decodeURIComponent(match[1]);
    const conversationId = decodeURIComponent(match[2]);
    const params = new URLSearchParams({
      account: accountId,
      conversation: conversationId,
    });
    const action = deepLink.searchParams.get('action');
    if (action) params.set('action', action);
    for (const name of ['message', 'subject', 'sender', 'snippet', 'receivedAt'] as const) {
      const value = deepLink.searchParams.get(name);
      if (value) params.set(name, value);
    }
    // Select the target before making any native call. Native mail commands are
    // serialized on Android, so awaiting metadata here used to leave the
    // previous conversation visible until an Inbox sync had completed.
    navigate('/?' + params.toString());
    setActiveTab('mail');

    void platform.notificationThread?.(accountId, conversationId).then(notificationThread => {
      if (!notificationThread || activeNotificationUrlRef.current !== url) return;
      setOpeningNotification(current => current?.url === url ? {
        ...current,
        subject: notificationThread.subject || current.subject,
        sender: notificationThread.sender || current.sender,
        snippet: notificationThread.snippet || current.snippet,
        receivedAt: notificationThread.receivedAt || current.receivedAt,
      } : current);
      globalThis.dispatchEvent(new CustomEvent('courrier:notification-thread', {
        detail: { accountId, conversationId, notificationThread },
      }));
    }).catch(error => {
      console.warn('[notification-link] metadata unavailable', error);
    });
  }, [navigate, setActiveTab]);

  useEffect(() => {
    // Only Android has a retained notification intent to resolve. On desktop
    // and web, release background enrichment immediately; otherwise snippets
    // and avatars remain disabled for the whole session.
    if (!platform.isNativeAndroid) {
      setNotificationOpening(false);
      return;
    }
    const refreshMail = () => {
      // Capacitor's WebView does not reliably emit a window focus transition
      // when the app resumes. In particular, after airplane mode React Query
      // can otherwise keep rendering a persisted/offline empty Inbox even
      // though the native worker has already synchronized new mail.
      void queryClient.invalidateQueries({
        queryKey: ['mail'],
        refetchType: 'active',
      });
    };
    const consumeNativeTarget = (releaseIfEmpty = false) => void platform.consumeNotificationUrl().then(url => {
      if (url) void openDeepLink(url);
      else if (releaseIfEmpty) setNotificationOpening(false);
    });
    consumeNativeTarget(true);
    void CapacitorApp.getLaunchUrl().then(result => {
      if (result?.url) void openDeepLink(result.url);
    });
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => openDeepLink(url));
    const stateListener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        refreshMail();
        consumeNativeTarget();
      }
      else activeNotificationUrlRef.current = null;
    });
    // Also cover connectivity returning while Courrier is already visible.
    globalThis.addEventListener('online', refreshMail);
    const notificationOpened = () => {
      void platform.diagnosticEvent?.('notification-skeleton-hidden');
      if (openingTimeoutRef.current) clearTimeout(openingTimeoutRef.current);
      openingTimeoutRef.current = null;
      setOpeningNotification(null);
      // Keep background avatars/snippets paused briefly after the body appears.
      // This prevents a burst from the first mail delaying a second notification
      // opened a few seconds later.
      if (enrichmentTimeoutRef.current) clearTimeout(enrichmentTimeoutRef.current);
      enrichmentTimeoutRef.current = setTimeout(() => {
        enrichmentTimeoutRef.current = null;
        setNotificationOpening(false);
      }, 15_000);
    };
    globalThis.addEventListener('courrier:notification-opened', notificationOpened);
    return () => {
      globalThis.removeEventListener('courrier:notification-opened', notificationOpened);
      if (openingTimeoutRef.current) clearTimeout(openingTimeoutRef.current);
      if (enrichmentTimeoutRef.current) clearTimeout(enrichmentTimeoutRef.current);
      globalThis.removeEventListener('online', refreshMail);
      void listener.then(handle => handle.remove());
      void stateListener.then(handle => handle.remove());
    };
  }, [openDeepLink]);
  if (!openingNotification) return null;
  const sender = openingNotification.sender || '';
  const senderAddressMatch = /<([^<>]+)>/.exec(sender);
  const senderEmail = senderAddressMatch?.[1] || sender;
  const senderName = senderAddressMatch ? sender.slice(0, senderAddressMatch.index).trim().replace(/^['"]|['"]$/g, '') : sender;
  const rawReceivedAt = openingNotification.receivedAt;
  const receivedAt = rawReceivedAt && /^\d+$/.test(rawReceivedAt)
    ? new Date(Number(rawReceivedAt)).toISOString()
    : rawReceivedAt;
  const deleteFromSkeleton = () => {
    const deleteUrl = new URL(openingNotification.url);
    deleteUrl.searchParams.set('action', 'delete');
    openDeepLink(deleteUrl.toString());
    // The deletion route now owns the transition to the neighbouring thread;
    // do not leave an obsolete loading cover in front of it.
    if (openingTimeoutRef.current) clearTimeout(openingTimeoutRef.current);
    openingTimeoutRef.current = null;
    setOpeningNotification(null);
    setNotificationOpening(false);
  };
  return <div className="notification-opening" role="region" aria-busy="true" aria-label="Ouverture du message">
    <div className="mail-mobile-detail-nav notification-opening__nav" aria-hidden="true">
      <button type="button"><ChevronLeft /></button>
      <div className="mail-mobile-detail-nav__position">Inbox</div>
      <div className="mail-mobile-detail-nav__arrows">
        <button type="button" disabled><ChevronUp /></button>
        <button type="button" disabled><ChevronDown /></button>
      </div>
    </div>
    <div className="mail-thread-detail notification-opening__content">
      <div className="mail-thread-detail__header">
        <h2 className="mail-thread-detail__subject">{openingNotification.subject || 'Ouverture du message…'}</h2>
      </div>
      <div className="mail-thread-detail__messages">
        <div className="mail-message-block expanded notification-opening__message">
          <div className="mail-message-block__header">
            {sender
              ? <ContactAvatar email={senderEmail} name={senderName} size={40} className="mail-message-block__avatar" eager />
              : <div className="notification-opening__avatar" />}
            <div className="mail-message-block__header-content">
              <div className="mail-message-block__row1">
                {sender
                  ? <span className="mail-message-block__from" style={{ color: senderColor(sender, resolved === 'dark') }}>{sender}</span>
                  : <div className="notification-opening__line notification-opening__line--sender" />}
                <span className="mail-message-block__date">{receivedAt ? formatDate(receivedAt) : <i className="notification-opening__date" />}</span>
              </div>
              <div className="mail-message-block__row2">
                <div className="mail-message-block__recipients-preview"><span className="mail-message-block__preview"><span className="mail-message-block__preview-label">à</span> moi</span></div>
                <button type="button" className="mail-headers-toggle" disabled><ChevronDown size={11} /></button>
                <button type="button" className="btn-icon--labeled" disabled><Reply size={13} /></button>
                <button type="button" className="btn-icon--labeled" disabled><MoreHorizontal size={18} /></button>
              </div>
            </div>
          </div>
          <div className="mail-message-block__body notification-opening__body">
            {openingNotification.snippet && <p>{openingNotification.snippet}</p>}
            <div className="mail-message-body-skeleton" aria-hidden="true"><span /><span /><span /></div>
          </div>
        </div>
      </div>
    </div>
    <div className="mail-thread-detail__toolbar notification-opening__toolbar">
      <div><button type="button" className="mail-detail-action-btn" disabled><FolderInput /><span>Déplacer</span></button></div>
      <button type="button" className="mail-detail-action-btn mail-detail-action-btn--danger" onClick={deleteFromSkeleton}><Trash2 /><span>Supprimer</span></button>
      <button type="button" className="mail-detail-action-btn" disabled><Archive /><span>Archiver</span></button>
      <div><button type="button" className="mail-detail-action-btn" disabled><MoreHorizontal /><span>More</span></button></div>
    </div>
  </div>;
}
