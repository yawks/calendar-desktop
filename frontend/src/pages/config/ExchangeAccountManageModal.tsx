import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, X } from 'lucide-react';
import { useExchangeAuth } from '../../shared/store/ExchangeAuthStore';
import { useCalendars } from '../../features/calendar/store/CalendarStore';
import { CalendarConfig, ExchangeAccount } from '../../shared/types';
import { CapBadge } from './ConfigShared';

export function ExchangeAccountManageModal({ account, existingCalendars, onClose }: {
  account: ExchangeAccount;
  existingCalendars: CalendarConfig[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { removeAccount, updateAccountCapabilities } = useExchangeAuth();
  const { removeCalendar } = useCalendars();
  const [capabilities, setCapabilities] = useState<('calendar' | 'email')[]>(
    account.enabledCapabilities ?? ['calendar', 'email']
  );

  const handleCapabilityChange = (cap: 'calendar' | 'email', enabled: boolean) => {
    const next = enabled ? [...capabilities, cap] : capabilities.filter((c) => c !== cap);
    setCapabilities(next);
    updateAccountCapabilities(account.id, next);
  };

  const accountCals = existingCalendars.filter(
    (c) => c.type === 'exchange' && c.exchangeAccountId === account.id
  );

  const handleDisconnect = () => {
    accountCals.forEach((c) => removeCalendar(c.id));
    removeAccount(account.id);
    onClose();
  };

  return (
    <div
      className="nc-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="nc-modal-box nc-modal-box--wide">
        <div className="nc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'calc(15px * var(--font-scale, 1))' }}>{account.displayName || account.email}</div>
              <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)' }}>{account.email}</div>
            </div>
          </div>
          <button type="button" className="nc-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="nc-modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
            <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('config.exchangeConnectedCalendars')}
            </div>
            {accountCals.map((cal) => (
              <div key={cal.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: cal.color, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ fontSize: 'calc(14px * var(--font-scale, 1))' }}>{cal.name}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 'calc(13px * var(--font-scale, 1))', color: 'var(--text-muted)', marginBottom: 10 }}>{t('config.enabledServices')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['calendar', 'email'] as const).map((cap) => (
                <label key={cap} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={capabilities.includes(cap)}
                    onChange={(e) => handleCapabilityChange(cap, e.target.checked)}
                    disabled={capabilities.length === 1 && capabilities.includes(cap)}
                  />
                  <CapBadge cap={cap} />
                  <span style={{ fontSize: 'calc(14px * var(--font-scale, 1))' }}>{t(`config.cap.${cap}`)}</span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <button
              type="button"
              className="btn-remove"
              onClick={handleDisconnect}
              style={{ fontSize: 'calc(13px * var(--font-scale, 1))', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Trash2 size={14} /> {t('config.disconnectAccount')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
