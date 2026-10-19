import { useState } from 'react';
import { openMailDraftWindow } from '../../../shared/services/mailDraftWindow';
import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLayout } from '../../../shared/store/LayoutStore';
import { useGoogleAuth } from '../../../shared/store/GoogleAuthStore';
import { useExchangeAuth } from '../../../shared/store/ExchangeAuthStore';
import { useImapAuth } from '../../../shared/store/ImapAuthStore';
import { useJmapAuth } from '../../../shared/store/JmapAuthStore';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
import { eventMailDraft } from '../utils/eventMailDraft';

export default function EventMailAction({ event, calendar, onClose }: {
  readonly event: CalendarEvent; readonly calendar: CalendarConfig; readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { layout, setActiveTab } = useLayout();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const { accounts: google } = useGoogleAuth();
  const { accounts: exchange } = useExchangeAuth();
  const { accounts: imap } = useImapAuth();
  const { accounts: jmap } = useJmapAuth();
  const draft = eventMailDraft(event, calendar, [
    ...google.filter(a => !a.enabledCapabilities || a.enabledCapabilities.includes('email')).map(a => ({ ...a, providerType: 'gmail' as const })),
    ...exchange.filter(a => !a.enabledCapabilities || a.enabledCapabilities.includes('email')).map(a => ({ ...a, providerType: 'ews' as const })),
    ...imap.map(a => ({ ...a, providerType: 'imap' as const })),
    ...jmap.map(a => ({ ...a, providerType: 'jmap' as const })),
  ], [...google, ...exchange, ...imap, ...jmap].map(account => account.email));
  if (!draft) return null;
  return <div className="event-mail-action">
    <button type="button" className="btn-ghost" disabled={opening} aria-busy={opening} onClick={async () => {
      setError(false);
      if (layout === 'windows') {
        setOpening(true);
        try {
          await openMailDraftWindow(draft);
          onClose();
        } catch {
          setError(true);
        } finally {
          setOpening(false);
        }
        return;
      }
      onClose();
      setActiveTab('mail');
      navigate('/mail', { state: { eventDraft: draft } });
    }}><Mail size={16} />{t(opening ? 'eventModal.openingMail' : 'eventModal.emailParticipants')}</button>
    {error && <p className="event-mail-action__error" role="alert">{t('eventModal.mailWindowError')}</p>}
  </div>;
}
