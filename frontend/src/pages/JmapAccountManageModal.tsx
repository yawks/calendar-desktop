import { useState, FormEvent } from 'react';
import { X, Mail, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { JmapAccount } from '../shared/types';
import { useJmapAuth } from '../shared/store/JmapAuthStore';

const DEFAULT_COLORS = [
  '#1a73e8', '#34a853', '#ea4335', '#fbbc04',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
];

function ColorSwatches({ colors, selected, onSelect }: {
  readonly colors: string[];
  readonly selected: string;
  readonly onSelect: (c: string) => void;
}) {
  return (
    <>
      {colors.map((c) => (
        <button
          key={c} type="button" onClick={() => onSelect(c)}
          style={{
            width: 24, height: 24, borderRadius: '50%', background: c, border: 'none',
            outline: selected === c ? `3px solid ${c}` : '2px solid transparent',
            outlineOffset: 2, cursor: 'pointer',
          }}
        />
      ))}
    </>
  );
}

export function JmapAccountManageModal({ account, onClose }: {
  account: JmapAccount;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { removeAccount, updateAccount } = useJmapAuth();

  const [email, setEmail] = useState(account.email);
  const [displayName, setDisplayName] = useState(account.displayName);
  const [sessionUrl, setSessionUrl] = useState(account.sessionUrl);
  const [token, setToken] = useState(account.token);
  const [color, setColor] = useState(account.color || DEFAULT_COLORS[0]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    updateAccount({
      ...account,
      email,
      displayName,
      sessionUrl,
      token,
      color,
    });
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
            <Mail size={24} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{account.displayName}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{account.email}</div>
            </div>
          </div>
          <button type="button" className="nc-modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="nc-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <form onSubmit={handleSave} className="config-form">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t('config.generalInfo', 'General')}</h3>
                  <div className="form-row">
                    <label>{t('config.email', 'Email')}</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.displayName', 'Display Name')}</label>
                    <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>{t('config.accountColor', 'Color')}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <ColorSwatches colors={DEFAULT_COLORS} selected={color} onSelect={setColor} />
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>JMAP Configuration</h3>
                <div className="form-row">
                  <label>Session URL</label>
                  <input type="text" value={sessionUrl} onChange={(e) => setSessionUrl(e.target.value)} placeholder="https://api.fastmail.com/jmap/session" required />
                </div>
                <div className="form-row">
                  <label>API Token</label>
                  <input type="password" value={token} onChange={(e) => setToken(e.target.value)} required />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <button
                  type="button"
                  className="btn-remove"
                  onClick={() => { removeAccount(account.id); onClose(); }}
                  style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Trash2 size={14} /> {t('config.disconnectAccount')}
                </button>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button type="submit" className="btn-primary">
                    {t('config.save', 'Enregistrer')}
                  </button>
                  <button type="button" className="btn-cancel" onClick={onClose}>
                    {t('config.cancel', 'Annuler')}
                  </button>
                </div>
              </div>
          </form>
        </div>
      </div>
    </div>
  );
}
