import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Languages, Mail, Cloud, Rss, Plus, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCalendars } from '../features/calendar/store/CalendarStore';
import { useGoogleAuth } from '../shared/store/GoogleAuthStore';
import { useExchangeAuth } from '../shared/store/ExchangeAuthStore';
import { useImapAuth } from '../shared/store/ImapAuthStore';
import { useJmapAuth } from '../shared/store/JmapAuthStore';
import { useDefaultCalendar } from '../features/calendar/store/defaultCalendarStore';
import { ImapAccountManageModal } from './ImapAccountManageModal';
import { JmapAccountManageModal } from './JmapAccountManageModal';
import { GoogleAccountManageModal } from './config/GoogleAccountManageModal';
import { ICSManageModal } from './config/ICSManageModal';
import { NextcloudManageModal } from './config/NextcloudManageModal';
import { ExchangeAccountManageModal } from './config/ExchangeAccountManageModal';
import { NewCalendarModal } from './config/NewCalendarModal';
import { PreferencesSection } from './config/PreferencesSection';
import { NativeSettingsSection } from '../shared/platform/NativeSettingsSection';
import { SignaturesSection } from './config/SignaturesSection';
import { CalendarItem, GroupSection } from './config/ConfigShared';

type SectionType = 'providers' | 'preferences';

type EditModalState =
  | { type: 'google'; accountId: string }
  | { type: 'exchange'; accountId: string }
  | { type: 'imap'; accountId: string }
  | { type: 'jmap'; accountId: string }
  | { type: 'ics' }
  | { type: 'nextcloud' }
  | null;

export default function ConfigPage() {
  const { t } = useTranslation();
  const { calendars } = useCalendars();
  const { accounts, updateAccountColor: updateGoogleColor } = useGoogleAuth();
  const { accounts: exchangeAccounts, updateAccountColor: updateExchangeColor } = useExchangeAuth();
  const { accounts: imapAccounts, updateAccountColor: updateImapColor } = useImapAuth();
  const { accounts: jmapAccounts, updateAccountColor: updateJmapColor } = useJmapAuth();
  const { defaultCalendarId, setDefaultCalendar } = useDefaultCalendar();

  const [activeSection, setActiveSection] = useState<SectionType>('providers');
  const [showNewCalModal, setShowNewCalModal] = useState(
    () => new URLSearchParams(globalThis.location.search).get('addSource') === '1',
  );
  const [editModal, setEditModal] = useState<EditModalState>(null);

  const icsCals = calendars.filter((c) => !c.type || c.type === 'ics');
  const nextcloudCals = calendars.filter((c) => c.type === 'nextcloud');

  const googleGroups = accounts.map((account) => ({
    account,
    cals: calendars.filter((c) => c.type === 'google' && c.googleAccountId === account.id),
  }));

  const exchangeGroups = exchangeAccounts.map((account) => ({
    account,
    cals: calendars.filter((c) => c.type === 'exchange' && c.exchangeAccountId === account.id),
  }));

  const hasAnyProvider =
    accounts.length > 0 || exchangeAccounts.length > 0 ||
    imapAccounts.length > 0 || jmapAccounts.length > 0 || icsCals.length > 0 || nextcloudCals.length > 0;

  const sections: { id: SectionType; label: string; icon: React.ReactNode }[] = [
    { id: 'providers', label: t('config.sectProviders'), icon: <SlidersHorizontal size={15} /> },
    { id: 'preferences', label: t('config.sectPreferences'), icon: <Languages size={15} /> },
  ];

  const editingGoogleAccount = editModal?.type === 'google'
    ? accounts.find((a) => a.id === (editModal as { type: 'google'; accountId: string }).accountId)
    : undefined;

  return (
    <div className="app">
      <header className="header config-header">
        <Link
          to="/"
          className="btn-config btn-config--icon-only config-header-back"
          aria-label={t('config.backToCalendar')}
          title={t('config.backToCalendar')}
        >
          <ChevronLeft size={28} aria-hidden="true" />
        </Link>
        <span className="config-header-title">{t('config.pageTitle')}</span>
      </header>

      <div className="app-body">
        <div className="config-layout">

          {/* ── Sidebar ── */}
          <nav className="config-sidebar">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`config-sidebar-item${activeSection === s.id ? ' config-sidebar-item--active' : ''}`}
                onClick={() => setActiveSection(s.id)}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </nav>

          {/* ── Content ── */}
          <div className="config-content">

            {activeSection === 'providers' && (
              <>
                <div className="config-section-header">
                  <h2 className="config-section-title">{t('config.sectProviders')}</h2>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setShowNewCalModal(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Plus size={15} />
                    {t('config.connectProvider')}
                  </button>
                </div>

                <NativeSettingsSection />

                {!hasAnyProvider && (
                  <div className="empty-state" style={{ marginTop: 32 }}>
                    {t('config.noProvidersConfigured')}
                  </div>
                )}

                {/* Google — one group per account */}
                {googleGroups.map(({ account, cals }) => (
                  <GroupSection
                    key={account.id}
                    title={account.email}
                    icon={
                      account.picture
                        ? <img src={account.picture} alt="" style={{ width: 14, height: 14, borderRadius: '50%' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        : (
                          <svg width="13" height="13" viewBox="0 0 18 18" aria-hidden="true">
                            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
                            <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
                            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" />
                          </svg>
                        )
                    }
                    onEdit={() => setEditModal({ type: 'google', accountId: account.id })}
                    caps={account.enabledCapabilities ?? ['calendar', 'email']}
                    color={account.color}
                    onColorChange={(c) => updateGoogleColor(account.id, c)}
                  >
                    {cals.length > 0
                      ? cals.map((cal) => <CalendarItem key={cal.id} cal={cal} isDefault={defaultCalendarId === cal.id} onSetDefault={() => setDefaultCalendar(cal.id)} />)
                      : <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)', padding: '2px 0' }}>{t('config.noCalendarsLinked')}</div>
                    }
                  </GroupSection>
                ))}

                {/* Exchange — one group per account */}
                {exchangeGroups.map(({ account, cals }) => (
                  <GroupSection
                    key={account.id}
                    title={account.email}
                    icon={
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect width="24" height="24" rx="4" fill="#0078d4" />
                        <text x="12" y="17" textAnchor="middle" fontSize="13" fontWeight="bold" fill="white" fontFamily="sans-serif">Ex</text>
                      </svg>
                    }
                    onEdit={() => setEditModal({ type: 'exchange', accountId: account.id })}
                    caps={account.enabledCapabilities ?? ['calendar', 'email']}
                    color={account.color}
                    onColorChange={(c) => updateExchangeColor(account.id, c)}
                  >
                    {cals.length > 0
                      ? cals.map((cal) => <CalendarItem key={cal.id} cal={cal} isDefault={defaultCalendarId === cal.id} onSetDefault={() => setDefaultCalendar(cal.id)} />)
                      : <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)', padding: '2px 0' }}>{t('config.noCalendarsLinked')}</div>
                    }
                  </GroupSection>
                ))}

                {/* IMAP */}
                {imapAccounts.map((account) => (
                  <GroupSection
                    key={account.id}
                    title={account.email}
                    icon={<Mail size={13} />}
                    onEdit={() => setEditModal({ type: 'imap', accountId: account.id })}
                    caps={['email']}
                    color={account.color}
                    onColorChange={(c) => updateImapColor(account.id, c)}
                  >
                    <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)', padding: '2px 0' }}>
                      {account.imapServer}
                    </div>
                  </GroupSection>
                ))}

                {/* JMAP */}
                {jmapAccounts.map((account) => (
                  <GroupSection
                    key={account.id}
                    title={account.email}
                    icon={<Mail size={13} />}
                    onEdit={() => setEditModal({ type: 'jmap', accountId: account.id })}
                    caps={['email']}
                    color={account.color}
                    onColorChange={(c) => updateJmapColor(account.id, c)}
                  >
                    <div style={{ fontSize: 'calc(12px * var(--font-scale, 1))', color: 'var(--text-muted)', padding: '2px 0' }}>
                      {account.sessionUrl}
                    </div>
                  </GroupSection>
                ))}

                {/* ICS */}
                {icsCals.length > 0 && (
                  <GroupSection
                    title="ICS / iCal"
                    icon={<Rss size={13} />}
                    onEdit={() => setEditModal({ type: 'ics' })}
                    caps={['calendar']}
                  >
                    {icsCals.map((cal) => <CalendarItem key={cal.id} cal={cal} isDefault={defaultCalendarId === cal.id} onSetDefault={() => setDefaultCalendar(cal.id)} />)}
                  </GroupSection>
                )}

                {/* Nextcloud */}
                {nextcloudCals.length > 0 && (
                  <GroupSection
                    title="Nextcloud / CalDAV"
                    icon={<Cloud size={13} />}
                    onEdit={() => setEditModal({ type: 'nextcloud' })}
                    caps={['calendar']}
                  >
                    {nextcloudCals.map((cal) => <CalendarItem key={cal.id} cal={cal} isDefault={defaultCalendarId === cal.id} onSetDefault={() => setDefaultCalendar(cal.id)} />)}
                  </GroupSection>
                )}

                {/* Signatures (sous-section intégrée) */}
                <SignaturesSection />
              </>
            )}

            {activeSection === 'preferences' && (
              <>
                <div className="config-section-header">
                  <h2 className="config-section-title">{t('config.sectPreferences')}</h2>
                </div>
                <PreferencesSection />
              </>
            )}

          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {showNewCalModal && (
        <NewCalendarModal
          onClose={() => setShowNewCalModal(false)}
        />
      )}
      {editModal?.type === 'google' && editingGoogleAccount && (
        <GoogleAccountManageModal
          account={editingGoogleAccount}
          existingCalendars={calendars}
          onClose={() => setEditModal(null)}
        />
      )}
      {editModal?.type === 'exchange' && (() => {
        const acc = exchangeAccounts.find((a) => a.id === (editModal as { type: 'exchange'; accountId: string }).accountId);
        return acc ? (
          <ExchangeAccountManageModal
            account={acc}
            existingCalendars={calendars}
            onClose={() => setEditModal(null)}
          />
        ) : null;
      })()}
      {editModal?.type === 'jmap' && (() => {
        const acc = jmapAccounts.find((a) => a.id === (editModal as { type: 'jmap'; accountId: string }).accountId);
        return acc ? (
          <JmapAccountManageModal
            account={acc}
            onClose={() => setEditModal(null)}
          />
        ) : null;
      })()}
      {editModal?.type === 'imap' && (() => {
        const acc = imapAccounts.find((a) => a.id === (editModal as { type: 'imap'; accountId: string }).accountId);
        return acc ? (
          <ImapAccountManageModal
            account={acc}
            onClose={() => setEditModal(null)}
          />
        ) : null;
      })()}
      {editModal?.type === 'ics' && (
        <ICSManageModal
          calendars={icsCals}
          onClose={() => setEditModal(null)}
        />
      )}
      {editModal?.type === 'nextcloud' && (
        <NextcloudManageModal
          calendars={nextcloudCals}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}
