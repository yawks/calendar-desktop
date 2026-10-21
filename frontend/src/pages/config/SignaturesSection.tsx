import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PenLine } from 'lucide-react';
import { useGoogleAuth } from '../../shared/store/GoogleAuthStore';
import { useExchangeAuth } from '../../shared/store/ExchangeAuthStore';
import { useImapAuth } from '../../shared/store/ImapAuthStore';
import { useJmapAuth } from '../../shared/store/JmapAuthStore';
import { EwsMailProvider } from '../../features/mail/providers/EwsMailProvider';
import { GmailMailProvider } from '../../features/mail/providers/GmailMailProvider';
import { ImapMailProvider } from '../../features/mail/providers/ImapMailProvider';
import { JmapMailProvider } from '../../features/mail/providers/JmapMailProvider';
import { useAllAccountIdentities } from '../../features/mail/hooks/useMailQueries';
import { MailEditor, MailEditorHandle } from '../../features/mail/components/MailEditor';
import { IdentitySelector } from '../../features/mail/components/IdentitySelector';
import { useSignatures, SignaturePosition } from '../../shared/store/SignatureStore';
import { MailProvider } from '../../features/mail/providers/MailProvider';

function useConfigIdentities() {
  const { accounts: ewsAccounts, getValidToken: getEwsToken } = useExchangeAuth();
  const { accounts: googleAccounts, getValidToken: getGoogleToken } = useGoogleAuth();
  const { accounts: imapAccounts } = useImapAuth();
  const { accounts: jmapAccounts } = useJmapAuth();

  const mailEwsAccounts = useMemo(
    () => ewsAccounts.filter(a => !a.enabledCapabilities || a.enabledCapabilities.includes('email')),
    [ewsAccounts]
  );
  const mailGoogleAccounts = useMemo(
    () => googleAccounts.filter(a => !a.enabledCapabilities || a.enabledCapabilities.includes('email')),
    [googleAccounts]
  );

  const providersRef = useRef<Map<string, MailProvider>>(new Map());

  const allAccountInfo = useMemo(() => {
    const current = providersRef.current;
    const next = new Map<string, MailProvider>();

    for (const a of mailEwsAccounts) {
      if (!current.has(a.id) || !(current.get(a.id) instanceof EwsMailProvider)) {
        next.set(a.id, new EwsMailProvider(a.id, getEwsToken, a.email));
      } else {
        next.set(a.id, current.get(a.id)!);
      }
    }
    for (const a of mailGoogleAccounts) {
      if (!current.has(a.id) || !(current.get(a.id) instanceof GmailMailProvider)) {
        next.set(a.id, new GmailMailProvider(a.id, getGoogleToken, a.email));
      } else {
        next.set(a.id, current.get(a.id)!);
      }
    }
    for (const a of imapAccounts) next.set(a.id, new ImapMailProvider(a));
    for (const a of jmapAccounts) next.set(a.id, new JmapMailProvider(a));
    providersRef.current = next;

    const accounts = [
      ...mailEwsAccounts.map(a => ({ id: a.id, email: a.email, name: a.displayName, color: a.color })),
      ...mailGoogleAccounts.map(a => ({ id: a.id, email: a.email, name: a.name, color: a.color })),
      ...imapAccounts.map(a => ({ id: a.id, email: a.email, name: a.displayName, color: a.color })),
      ...jmapAccounts.map(a => ({ id: a.id, email: a.email, name: a.displayName, color: a.color })),
    ];

    return accounts.map(a => {
      const atIdx = a.email.indexOf('@');
      const domain = atIdx >= 0 ? a.email.slice(atIdx + 1) : a.email;
      const label = domain.charAt(0).toUpperCase() + domain.slice(1);
      return { ...a, label, provider: next.get(a.id) ?? null };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailEwsAccounts, mailGoogleAccounts, imapAccounts, jmapAccounts]);

  return useAllAccountIdentities(allAccountInfo);
}

export function SignaturesSection() {
  const { t } = useTranslation();
  const identities = useConfigIdentities();
  const { signatures, signaturePosition, setSignature, setSignaturePosition } = useSignatures();

  const [selectedId, setSelectedId] = useState('');
  const editorRef = useRef<MailEditorHandle>(null);

  // Select first identity once loaded
  useEffect(() => {
    if (identities.length > 0 && !selectedId) {
      setSelectedId(identities[0].id);
    }
  }, [identities, selectedId]);

  const handleSelect = (id: string) => {
    // Auto-save current editor content before switching
    if (selectedId && editorRef.current) {
      setSignature(selectedId, editorRef.current.getHTML());
    }
    setSelectedId(id);
  };

  const handleSave = () => {
    if (selectedId && editorRef.current) {
      setSignature(selectedId, editorRef.current.getHTML());
    }
  };

  if (identities.length === 0) return null;

  return (
    <section className="native-settings-card signatures-card">
      <header className="native-settings-card__header">
        <div className="native-settings-card__icon" aria-hidden="true"><PenLine size={20} /></div>
        <div>
          <h3>{t('config.signatures.title', 'Signatures')}</h3>
          <p>{t('config.signatures.hint', 'Définissez une signature par alias. Elle sera insérée automatiquement lors de la rédaction.')}</p>
        </div>
      </header>

      {/* Position globale */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'calc(13px * var(--font-scale, 1))', fontWeight: 500 }}>
          {t('config.signatures.position', 'Position')}
        </span>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {(['bottom', 'above-quoted'] as SignaturePosition[]).map((pos, i) => (
            <button
              key={pos}
              type="button"
              onClick={() => setSignaturePosition(pos)}
              style={{
                padding: '6px 14px',
                border: 'none',
                borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
                background: signaturePosition === pos ? 'var(--color-primary, #1a73e8)' : 'transparent',
                color: signaturePosition === pos ? '#fff' : 'var(--text)',
                fontWeight: signaturePosition === pos ? 600 : 400,
                cursor: 'pointer',
                fontSize: 'calc(13px * var(--font-scale, 1))',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {pos === 'bottom'
                ? t('config.signatures.posBottom', 'Tout en bas')
                : t('config.signatures.posAboveQuoted', 'Au-dessus du fil cité')}
            </button>
          ))}
        </div>
      </div>

      {/* Sélecteur d'alias + éditeur unique */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {/* Header: sélecteur + bouton save */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'var(--bg-secondary, var(--bg))',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <IdentitySelector
              identities={identities}
              selectedIdentityId={selectedId}
              onSelect={handleSelect}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            style={{ fontSize: 'calc(12px * var(--font-scale, 1))', padding: '4px 12px', flexShrink: 0 }}
            onClick={handleSave}
          >
            {t('config.signatures.save', 'Enregistrer')}
          </button>
        </div>

        {/* Éditeur WYSIWYG — remonté à chaque changement d'alias via key */}
        <div key={selectedId} style={{ minHeight: 120 }}>
          <MailEditor
            ref={editorRef}
            initialHTML={signatures[selectedId] ?? ''}
            placeholder={t('config.signatures.placeholder', 'Votre signature…')}
            disableAutoFocus
          />
        </div>
      </div>
    </section>
  );
}
