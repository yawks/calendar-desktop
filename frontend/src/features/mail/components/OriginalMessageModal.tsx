import { CodeXml, Copy, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { MailProvider } from '../providers/MailProvider';
import type { MailMessage } from '../types';

interface OriginalMessageModalProps {
  readonly message: MailMessage;
  readonly provider?: MailProvider | null;
  readonly onClose: () => void;
}

export function OriginalMessageModal({ message, provider, onClose }: OriginalMessageModalProps) {
  const { t } = useTranslation();
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setSource('');
    const request = provider?.getRawMessageSource
      ? provider.getRawMessageSource(message.item_id)
      : Promise.resolve(message.body_html);
    request
      .then(value => { if (active) setSource(value); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [message.body_html, message.item_id, provider]);

  return createPortal(
    <>
      <button type="button" className="mail-source-overlay" aria-label={t('mail.close', 'Close')} onClick={onClose} />
      <dialog open className="mail-source-dialog" aria-labelledby="mail-source-title">
        <div className="mail-source-dialog__header">
          <CodeXml size={16} />
          <strong id="mail-source-title">{t('mail.originalMessage', 'Original message')}</strong>
          <button
            type="button"
            className="mail-source-dialog__copy"
            disabled={!source}
            onClick={() => navigator.clipboard.writeText(source)}
          >
            <Copy size={14} /> {t('mail.copy', 'Copy')}
          </button>
          <button type="button" className="btn-icon" onClick={onClose} aria-label={t('mail.close', 'Close')}><X size={16} /></button>
        </div>
        <div className="mail-source-dialog__body">
          {loading && <RefreshCw size={28} className="spin" />}
          {!loading && error && <div className="mail-source-dialog__error">{error}</div>}
          {!loading && !error && <textarea readOnly value={source} spellCheck={false} />}
        </div>
      </dialog>
    </>,
    document.body,
  );
}
