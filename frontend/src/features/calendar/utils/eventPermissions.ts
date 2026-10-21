import type { CalendarConfig, CalendarEvent, ExchangeAccount } from '../../../shared/types';
import { isCalendarWritable } from './sharedCalendars';

export function isEventOrganizer(event: CalendarEvent, calendar: CalendarConfig, exchangeAccounts: ExchangeAccount[]): boolean {
  if (calendar.type === 'exchange') {
    if (!calendar.exchangeAccountId) return false;
    if (!event.attendees?.length) return true;
    const account = exchangeAccounts.find(a => a.id === calendar.exchangeAccountId);
    if (!account) return false;
    return event.attendees.some(a => a.isOrganizer && (
      a.email.toLowerCase() === account.email.toLowerCase()
      || !!account.displayName && a.name.toLowerCase() === account.displayName.toLowerCase()
    ));
  }
  const ownerEmail = calendar.ownerEmail?.toLowerCase();
  return !event.attendees?.length || !!ownerEmail && event.attendees.some(a =>
    a.isOrganizer && a.email.toLowerCase() === ownerEmail
  );
}

export function isEventEditable(event: CalendarEvent, calendar: CalendarConfig | undefined, exchangeAccounts: ExchangeAccount[]): boolean {
  return !!calendar && !event.readOnly && !event.isTask && isCalendarWritable(calendar)
    && isEventOrganizer(event, calendar, exchangeAccounts);
}
