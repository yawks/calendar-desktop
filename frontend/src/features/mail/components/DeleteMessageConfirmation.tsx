import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DeleteMessageConfirmationProps {
  readonly permanent: boolean;
  readonly deleting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function DeleteMessageConfirmation({ permanent, deleting, onCancel, onConfirm }: DeleteMessageConfirmationProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [deleting, onCancel]);

  return (
    <div className="mail-delete-confirmation" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !deleting) onCancel();
    }}>
      <div className="mail-delete-confirmation__dialog" role="dialog" aria-modal="true" aria-labelledby="mail-delete-confirmation-title">
        <button type="button" className="mail-delete-confirmation__close" onClick={onCancel} disabled={deleting} aria-label={t('mail.cancel', 'Cancel')}>
          <X size={18} />
        </button>
        <AlertTriangle className="mail-delete-confirmation__icon" size={28} />
        <h2 id="mail-delete-confirmation-title">{t('mail.confirmDeleteMessageTitle', 'Delete this message?')}</h2>
        <p>{permanent
          ? t('mail.confirmPermanentDeleteMessage', 'This message will be permanently deleted. This action cannot be undone.')
          : t('mail.confirmDeleteMessage', 'This message will be moved to the trash.')}</p>
        <div className="mail-delete-confirmation__actions">
          <button type="button" className="mail-delete-confirmation__cancel" onClick={onCancel} disabled={deleting}>{t('mail.cancel', 'Cancel')}</button>
          <button type="button" className="mail-delete-confirmation__delete" onClick={onConfirm} disabled={deleting} autoFocus>
            {deleting ? t('mail.deleting', 'Deleting…') : t('mail.delete', 'Delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
