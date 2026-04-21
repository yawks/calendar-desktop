import {
  ChevronDown,
  ChevronUp,
  Forward,
  Mail,
  MailOpen,
  Paperclip,
  Reply,
  ReplyAll,
  Trash2,
} from 'lucide-react';
import { MouseEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../../shared/store/ThemeStore';
import { avatarColor, formatDate, formatFullDate, formatSize, initials, senderColor } from '../utils';
import { MailMessage, MailRecipient } from '../types';

// ── Props ──────────────────────────────────────────────────────────────────────

interface MessageBlockHeaderProps {
  readonly message: MailMessage;
  readonly expanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onReply: (msg: MailMessage) => void;
  readonly onReplyAll: (msg: MailMessage) => void;
  readonly onForward: (msg: MailMessage) => void;
  readonly onTrash: (id: string) => void;
  readonly onToggleRead: (msg: MailMessage) => void;
  readonly onComposeToContact?: (recipient: MailRecipient) => void;
}

// ── Recipient chip ─────────────────────────────────────────────────────────────

interface RecipientChipProps {
  readonly recipient: MailRecipient;
  readonly onClick?: (r: MailRecipient) => void;
}

function RecipientChip({ recipient, onClick }: RecipientChipProps) {
  const label = recipient.name
    ? `${recipient.name} <${recipient.email}>`
    : recipient.email;
  return (
    <button
      type="button"
      className="mail-recipient-chip"
      onClick={() => onClick?.(recipient)}
    >
      {label}
    </button>
  );
}

// ── Actions dropdown menu ──────────────────────────────────────────────────────

interface ActionsMenuProps {
  readonly message: MailMessage;
  readonly onReply: (m: MailMessage) => void;
  readonly onReplyAll: (m: MailMessage) => void;
  readonly onForward: (m: MailMessage) => void;
  readonly onToggleRead: (m: MailMessage) => void;
  readonly onTrash: (id: string) => void;
  readonly onClose: () => void;
}

function ActionsMenu({ message, onReply, onReplyAll, onForward, onToggleRead, onTrash, onClose }: ActionsMenuProps) {
  const { t } = useTranslation();
  const act = (e: MouseEvent, fn: () => void) => { e.stopPropagation(); fn(); onClose(); };
  return (
    <div className="mail-actions-menu">
      <button type="button" className="mail-actions-menu__item"
        onClick={e => act(e, () => onReply(message))}>
        <Reply size={14} /><span>{t('mail.reply', 'Reply')}</span>
      </button>
      <button type="button" className="mail-actions-menu__item"
        onClick={e => act(e, () => onReplyAll(message))}>
        <ReplyAll size={14} /><span>{t('mail.replyAll', 'Reply to all')}</span>
      </button>
      <button type="button" className="mail-actions-menu__item"
        onClick={e => act(e, () => onForward(message))}>
        <Forward size={14} /><span>{t('mail.forward', 'Forward')}</span>
      </button>

      <div className="mail-actions-menu__separator" />

      <button type="button" className="mail-actions-menu__item"
        onClick={e => act(e, () => onToggleRead(message))}>
        {message.is_read
          ? <><MailOpen size={14} /><span>{t('mail.markUnread', 'Mark as unread')}</span></>
          : <><Mail size={14} /><span>{t('mail.markRead', 'Mark as read')}</span></>}
      </button>

      <div className="mail-actions-menu__separator" />

      <button type="button" className="mail-actions-menu__item mail-actions-menu__item--danger"
        onClick={e => act(e, () => onTrash(message.item_id))}>
        <Trash2 size={14} /><span>{t('mail.delete', 'Delete')}</span>
      </button>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function MessageBlockHeader({
  message,
  expanded,
  onToggleExpand,
  onReply,
  onReplyAll,
  onForward,
  onTrash,
  onToggleRead,
  onComposeToContact,
}: MessageBlockHeaderProps) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';

  const [showHeaders, setShowHeaders] = useState(false);
  const [showActions, setShowActions] = useState(false);

  // Collapse headers panel when block collapses
  useEffect(() => { if (!expanded) setShowHeaders(false); }, [expanded]);

  const sender    = message.from_name ?? message.from_email ?? '?';
  const fromLabel = message.from_name ?? message.from_email ?? t('mail.unknown', 'Unknown');
  const toLabel   = message.to_recipients.map(r => r.name ?? r.email).join(', ');
  const isMulti   = message.to_recipients.length > 1 || message.cc_recipients.length > 0;

  // Each action button stops propagation so the parent header's onClick
  // (which toggles expand/collapse) is not triggered.
  const sp = (e: MouseEvent) => e.stopPropagation();

  // ── Collapsed: compact single-row stacked card ────────────────────────────
  if (!expanded) {
    return (
      <button
        type="button"
        className="mail-message-block__header mail-message-block__header--compact"
        onClick={onToggleExpand}
      >
        <div
          className="mail-message-block__avatar mail-message-block__avatar--small"
          style={{ background: avatarColor(sender) }}
        >
          {initials(sender)}
        </div>
        <span
          className="mail-message-block__from--compact"
          style={{ color: senderColor(sender, isDark) }}
        >
          {fromLabel}
        </span>
        <span className="mail-message-block__preview--collapsed">{message.subject}</span>
        {message.has_attachments && <Paperclip size={11} className="mail-message-block__clip" />}
        <span className="mail-message-block__date">{formatDate(message.date_time_received)}</span>
        <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
      </button>
    );
  }

  return (
    <>
      {/* ── Clickable header ─────────────────────────────────────────────────── */}
      <div className="mail-message-block__header" onClick={onToggleExpand}>

        {/* Avatar */}
        <div className="mail-message-block__avatar" style={{ background: avatarColor(sender) }}>
          {initials(sender)}
        </div>

        {/* 2-row content */}
        <div className="mail-message-block__header-content">

          {/* Row 1 — sender name (coloured) + date */}
          <div className="mail-message-block__row1">
            <span className="mail-message-block__from" style={{ color: senderColor(sender, isDark) }}>
              {fromLabel}
            </span>
            <span className="mail-message-block__date" title={formatFullDate(message.date_time_received)}>
              {formatDate(message.date_time_received)}
            </span>
          </div>

          {/* Row 2 — preview + show-headers chevron + actions + collapse icon
              Each interactive child stops propagation individually so that
              clicking an action button doesn't also toggle the block. */}
          <div className="mail-message-block__row2">

            {/* Preview text — clicking bubbles to the header div (toggles expand) */}
            {expanded ? (
              <div className="mail-message-block__recipients-preview">
                <span className="mail-message-block__preview">
                  <span className="mail-message-block__preview-label">{t('mail.to', 'To')}</span>
                  {' '}{toLabel}
                </span>
                {message.cc_recipients.length > 0 && (
                  <span className="mail-message-block__preview">
                    <span className="mail-message-block__preview-label">Cc</span>
                    {' '}{message.cc_recipients.map(r => r.name ?? r.email).join(', ')}
                  </span>
                )}
              </div>
            ) : (
              <span className="mail-message-block__preview">{message.subject}</span>
            )}

            {/* Show-headers chevron — immediately after recipients */}
            {expanded && (
              <button
                type="button"
                className="mail-headers-toggle"
                title={showHeaders ? t('mail.hideHeaders', 'Hide headers') : t('mail.showHeaders', 'Show headers')}
                onClick={e => { sp(e); setShowHeaders(v => !v); }}
              >
                {showHeaders ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            )}

            {/* Spacer pushes action buttons to the right */}
            <span className="mail-message-block__row2-spacer" />

            {/* Reply / Reply to all */}
            {expanded && (isMulti ? (
              <button type="button" className="btn-icon--labeled"
                onClick={e => { sp(e); onReplyAll(message); }}>
                <ReplyAll size={13} /><span>{t('mail.replyAll', 'Reply to all')}</span>
              </button>
            ) : (
              <button type="button" className="btn-icon--labeled"
                onClick={e => { sp(e); onReply(message); }}>
                <Reply size={13} /><span>{t('mail.reply', 'Reply')}</span>
              </button>
            ))}

            {/* Actions dropdown */}
            {expanded && (
              <div className="mail-actions-dropdown">
                <button type="button" className="btn-icon--labeled"
                  onClick={e => { sp(e); setShowActions(v => !v); }}>
                  <span>{t('mail.actions', 'Actions')}</span>
                  <ChevronDown size={11} />
                </button>
                {showActions && (
                  <>
                    <div className="mail-actions-backdrop" onClick={e => { e.stopPropagation(); setShowActions(false); }} />
                    <ActionsMenu
                      message={message}
                      onReply={onReply} onReplyAll={onReplyAll} onForward={onForward}
                      onToggleRead={onToggleRead} onTrash={onTrash}
                      onClose={() => setShowActions(false)}
                    />
                  </>
                )}
              </div>
            )}

            {/* Collapse chevron — clicking bubbles to the header div */}
            <ChevronUp size={14} className={expanded ? '' : 'mail-chevron--collapsed'} />
          </div>
        </div>
      </div>

      {/* ── Full headers panel ────────────────────────────────────────────────── */}
      {expanded && showHeaders && (
        <div className="mail-message-block__headers-panel" onClick={sp}>
          <div className="mail-headers-row">
            <span className="mail-headers-label">{t('mail.from', 'From')}</span>
            <span className="mail-headers-value">
              {message.from_name && <span>{message.from_name} </span>}
              {message.from_email && <span className="mail-meta-email">&lt;{message.from_email}&gt;</span>}
            </span>
          </div>

          {message.to_recipients.length > 0 && (
            <div className="mail-headers-row">
              <span className="mail-headers-label">{t('mail.to', 'To')}</span>
              <div className="mail-headers-recipients">
                {message.to_recipients.map((r, i) => (
                  <RecipientChip key={i} recipient={r} onClick={onComposeToContact} />
                ))}
              </div>
            </div>
          )}

          {message.cc_recipients.length > 0 && (
            <div className="mail-headers-row">
              <span className="mail-headers-label">Cc</span>
              <div className="mail-headers-recipients">
                {message.cc_recipients.map((r, i) => (
                  <RecipientChip key={i} recipient={r} onClick={onComposeToContact} />
                ))}
              </div>
            </div>
          )}

          <div className="mail-headers-row">
            <span className="mail-headers-label">{t('mail.subject', 'Subject')}</span>
            <span className="mail-headers-value">{message.subject}</span>
          </div>

          <div className="mail-headers-row">
            <span className="mail-headers-label">{t('mail.date', 'Date')}</span>
            <span className="mail-headers-value">{formatFullDate(message.date_time_received)}</span>
          </div>

          {message.size !== undefined && (
            <div className="mail-headers-row">
              <span className="mail-headers-label">{t('mail.size', 'Size')}</span>
              <span className="mail-headers-value">{formatSize(message.size)}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
