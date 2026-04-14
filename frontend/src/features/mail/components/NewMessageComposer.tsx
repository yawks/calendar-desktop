import { useState } from 'react';
import { FromAccount, ComposerRestoreData } from '../types';
import { MailComposer } from './MailComposer';
import { ComposerAttachment } from '../providers/MailProvider';
import { X, ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface NewMessageComposerProps {
  readonly contacts: { email: string; name?: string }[];
  readonly restoreData: ComposerRestoreData | null;
  readonly onSend: (to: string[], cc: string[], bcc: string[], subject: string, body: string, attachments: ComposerAttachment[]) => Promise<void>;
  readonly onCancel: () => void;
  readonly onSaveDraft: (to: string[], cc: string[], bcc: string[], subject: string, body: string) => void;
  readonly onDeleteDraft?: () => void;
  readonly fromAccounts: FromAccount[];
  readonly fromAccountId: string;
  readonly onFromAccountChange: (id: string) => void;
}

export function NewMessageComposer({
  contacts, restoreData, onSend, onCancel, onSaveDraft, onDeleteDraft,
  fromAccounts, fromAccountId, onFromAccountChange
}: NewMessageComposerProps) {
  const { t } = useTranslation();
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showClosePopover, setShowClosePopover] = useState(false);

  const selectedAccount = fromAccounts.find(a => a.id === fromAccountId) || fromAccounts[0];

  const handleCancel = () => {
    setShowClosePopover(true);
  };

  return (
    <div className="mail-new-message">
      <div className="mail-new-message__overlay" onClick={handleCancel} />
      <div className="mail-new-message__container">
        <div className="mail-new-message__header">
          <div className="mail-new-message__from-area">
            <span className="mail-new-message__from-label">{t('mail.from', 'De')} :</span>
            <div className="mail-new-message__from-selector-container">
               <button
                 className="mail-new-message__from-btn"
                 onClick={() => setShowFromSelector(!showFromSelector)}
               >
                 <div className="mail-new-message__account-pill" style={{ backgroundColor: selectedAccount?.color }}>
                   {selectedAccount?.email}
                 </div>
                 <ChevronDown size={14} />
               </button>
               {showFromSelector && (
                 <div className="mail-new-message__from-dropdown">
                   {fromAccounts.map(acc => (
                     <div
                       key={acc.id}
                       className={`mail-new-message__from-item ${acc.id === fromAccountId ? 'selected' : ''}`}
                       onClick={() => { onFromAccountChange(acc.id); setShowFromSelector(false); }}
                     >
                       <div className="mail-new-message__account-pill" style={{ backgroundColor: acc.color }}>
                         {acc.email}
                       </div>
                       {acc.id === fromAccountId && <Check size={14} />}
                     </div>
                   ))}
                 </div>
               )}
            </div>
          </div>
          <button className="mail-new-message__close" onClick={handleCancel}>
            <X size={20} />
          </button>
        </div>

        <div className="mail-new-message__body">
          <MailComposer
            contacts={contacts}
            restoreData={restoreData}
            onSend={onSend}
            onCancel={handleCancel}
            onSaveDraft={onSaveDraft}
          />
        </div>

        {showClosePopover && (
          <div className="mail-close-popover">
            <div className="mail-close-popover__content">
              <h3>{t('mail.closeComposerTitle', 'Fermer le message ?')}</h3>
              <p>{t('mail.closeComposerDesc', 'Voulez-vous enregistrer ce message en tant que brouillon ?')}</p>
              <div className="mail-close-popover__actions">
                <button className="btn-secondary" onClick={() => { onDeleteDraft?.(); onCancel(); }}>{t('mail.discard', 'Ignorer')}</button>
                <button className="btn-primary" onClick={() => { onCancel(); }}>{t('mail.saveDraft', 'Enregistrer')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
