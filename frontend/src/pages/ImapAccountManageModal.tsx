import { useState, FormEvent } from 'react';
import { X, Mail, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ImapAccount } from '../shared/types';
import { useImapAuth } from '../shared/store/ImapAuthStore';

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

export function ImapAccountManageModal({ account, onClose }: {
  account: ImapAccount;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { removeAccount, updateAccount } = useImapAuth();

  const [email, setEmail] = useState(account.email);
  const [displayName, setDisplayName] = useState(account.displayName);
  const [imapServer, setImapServer] = useState(account.imapServer);
  const [imapPort, setImapPort] = useState(account.imapPort);
  const [imapUseSsl, setImapUseSsl] = useState(account.imapUseSsl);
  const [imapUseStarttls, setImapUseStarttls] = useState(account.imapUseStarttls);
  const [imapUsername, setImapUsername] = useState(account.imapUsername);
  const [imapPassword, setImapPassword] = useState(account.imapPassword);
  const [smtpServer, setSmtpServer] = useState(account.smtpServer);
  const [smtpPort, setSmtpPort] = useState(account.smtpPort);
  const [smtpUseSsl, setSmtpUseSsl] = useState(account.smtpUseSsl);
  const [smtpUseStarttls, setSmtpUseStarttls] = useState(account.smtpUseStarttls);
  const [smtpUsername, setSmtpUsername] = useState(account.smtpUsername);
  const [smtpPassword, setSmtpPassword] = useState(account.smtpPassword);
  const [color, setColor] = useState(account.color || DEFAULT_COLORS[0]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    updateAccount({
      ...account,
      email,
      displayName,
      imapServer,
      imapPort,
      imapUseSsl,
      imapUseStarttls,
      imapUsername,
      imapPassword,
      smtpServer,
      smtpPort,
      smtpUseSsl,
      smtpUseStarttls,
      smtpUsername,
      smtpPassword,
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>IMAP (Incoming)</h3>
                  <div className="form-row">
                    <label>{t('config.server', 'Server')}</label>
                    <input type="text" value={imapServer} onChange={(e) => setImapServer(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.port', 'Port')}</label>
                    <input type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} required />
                  </div>
                  <div className="form-row--inline" style={{ display: 'flex', gap: 15, margin: '8px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={imapUseSsl} onChange={(e) => { setImapUseSsl(e.target.checked); if (e.target.checked) setImapUseStarttls(false); }} />
                      SSL / TLS
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={imapUseStarttls} onChange={(e) => { setImapUseStarttls(e.target.checked); if (e.target.checked) setImapUseSsl(false); }} />
                      STARTTLS
                    </label>
                  </div>
                  <div className="form-row">
                    <label>{t('config.username', 'Username')}</label>
                    <input type="text" value={imapUsername} onChange={(e) => setImapUsername(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.password', 'Password')}</label>
                    <input type="password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} required />
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>SMTP (Outgoing)</h3>
                  <div className="form-row">
                    <label>{t('config.server', 'Server')}</label>
                    <input type="text" value={smtpServer} onChange={(e) => setSmtpServer(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.port', 'Port')}</label>
                    <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} required />
                  </div>
                  <div className="form-row--inline" style={{ display: 'flex', gap: 15, margin: '8px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={smtpUseSsl} onChange={(e) => { setSmtpUseSsl(e.target.checked); if (e.target.checked) setSmtpUseStarttls(false); }} />
                      SSL / TLS
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={smtpUseStarttls} onChange={(e) => { setSmtpUseStarttls(e.target.checked); if (e.target.checked) setSmtpUseSsl(false); }} />
                      STARTTLS
                    </label>
                  </div>
                  <div className="form-row">
                    <label>{t('config.username', 'Username')}</label>
                    <input type="text" value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} required />
                  </div>
                  <div className="form-row">
                    <label>{t('config.password', 'Password')}</label>
                    <input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} required />
                  </div>
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
