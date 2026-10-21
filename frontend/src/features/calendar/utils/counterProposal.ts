import type { CalendarEvent } from '../../../shared/types';

/** Never choose between several occurrences or same-title meetings. */
export function matchCounterProposal(proposal: { uid?: string; title: string; recurrenceId?: string; relatedItemId?: string }, events: CalendarEvent[]): CalendarEvent | null {
  const related = proposal.relatedItemId ? events.filter(event => event.sourceId?.split('|')[0] === proposal.relatedItemId) : [];
  if (related.length === 1) return related[0];
  const sameUid = proposal.uid ? events.filter(event => event.icalUid === proposal.uid) : [];
  const title = (value: string) => value.replace(/^(?:new time proposed|proposed new time|nouvel horaire proposé|proposition de nouvel horaire)\s*:\s*/i, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const candidates = sameUid.length ? sameUid : events.filter(event =>
    !event.icalUid && title(event.title) === title(proposal.title));
  const occurrences = proposal.recurrenceId ? candidates.filter(event =>
    new Date(event.recurrenceId ?? event.start).getTime() === new Date(proposal.recurrenceId!).getTime()) : candidates;
  return occurrences.length === 1 ? occurrences[0] : null;
}
