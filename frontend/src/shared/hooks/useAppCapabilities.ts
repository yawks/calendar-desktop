import { useCalendars } from '../../features/calendar/store/CalendarStore';
import { useExchangeAuth } from '../store/ExchangeAuthStore';
import { useGoogleAuth } from '../store/GoogleAuthStore';
import { useImapAuth } from '../store/ImapAuthStore';
import { useJmapAuth } from '../store/JmapAuthStore';

export function useAppCapabilities() {
  const { calendars } = useCalendars();
  const { accounts: googleAccounts } = useGoogleAuth();
  const { accounts: exchangeAccounts } = useExchangeAuth();
  const { accounts: imapAccounts } = useImapAuth();
  const { accounts: jmapAccounts } = useJmapAuth();

  const accountHasCapability = (
    account: { enabledCapabilities?: ('calendar' | 'email')[] },
    capability: 'calendar' | 'email',
  ) => (account.enabledCapabilities ?? ['calendar', 'email']).includes(capability);

  const hasCalendar = calendars.length > 0
    || googleAccounts.some((account) => accountHasCapability(account, 'calendar'))
    || exchangeAccounts.some((account) => accountHasCapability(account, 'calendar'));
  const hasMail = imapAccounts.length > 0
    || jmapAccounts.length > 0
    || googleAccounts.some((account) => accountHasCapability(account, 'email'))
    || exchangeAccounts.some((account) => accountHasCapability(account, 'email'));

  return {
    hasCalendar,
    hasMail,
    hasSource: calendars.length > 0
      || googleAccounts.length > 0
      || exchangeAccounts.length > 0
      || imapAccounts.length > 0
      || jmapAccounts.length > 0,
  };
}
