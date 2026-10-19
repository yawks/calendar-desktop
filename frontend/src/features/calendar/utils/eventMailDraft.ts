import type { CalendarConfig, CalendarEvent } from '../../../shared/types';
import type { ComposerRestoreData, FromAccount } from '../../mail/types';

export function eventMailDraft(event: CalendarEvent, calendar: CalendarConfig, accounts: FromAccount[], selfEmails = accounts.map(account => account.email)): ComposerRestoreData | null {
  const linkedId = calendar.type === 'google' ? calendar.googleAccountId : calendar.type === 'exchange' ? calendar.exchangeAccountId : undefined;
  const providerType = calendar.type === 'google' ? 'gmail' : calendar.type === 'exchange' ? 'ews' : undefined;
  const candidates = accounts.filter(account => (!providerType || account.providerType === providerType) && (linkedId
    ? account.id === linkedId
    : account.email.trim().toLowerCase() === calendar.ownerEmail?.trim().toLowerCase()));
  if (candidates.length !== 1) return null;
  const self = new Set(selfEmails.map(email => email.trim().toLowerCase()));
  const seen = new Set<string>();
  const participants = (event.attendees ?? []).slice().sort((a, b) => Number(Boolean(b.isOrganizer)) - Number(Boolean(a.isOrganizer))).filter(attendee => {
    const email = attendee.email.trim().toLowerCase();
    if (!email || self.has(email) || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
  const recipient = (attendee: NonNullable<CalendarEvent['attendees']>[number]) => ({ email: attendee.email.trim(), name: attendee.name });
  const to = participants.filter(attendee => attendee.isOrganizer).map(recipient);
  const cc = participants.filter(attendee => !attendee.isOrganizer).map(recipient);
  return {
    toRecipients: to, ccRecipients: cc, bccRecipients: [], subject: event.title, body: '', attachments: [],
    showCc: cc.length > 0, showBcc: false, isNewMessage: true, replyingToMsg: null,
    fromAccountId: candidates[0].id, initialFocus: to.length ? 'subject' : 'to',
  };
}
