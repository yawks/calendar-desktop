import { expect, it } from 'vitest';
import type { CalendarEvent } from '../../../shared/types';
import { matchCounterProposal } from './counterProposal';
const original = { id: 'original', icalUid: 'meeting', title: 'Meeting', start: '2026-10-21T08:00:00Z' } as CalendarEvent;
it('uses the scheduling UID despite different titles or proposed dates', () => {
  expect(matchCounterProposal({ uid: 'meeting', title: 'New time proposed: Meeting' }, [original, { ...original, id: 'other', icalUid: 'other' }])).toBe(original);
});
it('chooses the original occurrence using RECURRENCE-ID', () => {
  expect(matchCounterProposal({ uid: 'meeting', title: 'Meeting', recurrenceId: original.start }, [original, { ...original, id: 'next', start: '2026-10-28T08:00:00Z' }])).toBe(original);
});
it('rejects ambiguous titles and mismatched known UIDs', () => {
  expect(matchCounterProposal({ uid: 'other', title: 'Meeting' }, [original])).toBeNull();
  const cached = { ...original, icalUid: undefined };
  expect(matchCounterProposal({ title: 'Meeting' }, [cached, { ...cached, id: 'other' }])).toBeNull();
});
it('supports old caches only when the title identifies one meeting', () => {
  const cached = { ...original, icalUid: undefined };
  expect(matchCounterProposal({ title: 'New time proposed: Meeting' }, [cached])).toBe(cached);
});
it('uses the associated Exchange item even if the mail has a different UID', () => {
  const event = { ...original, sourceId: 'ews-item|key' };
  expect(matchCounterProposal({ uid: 'mail-item', title: 'Different subject', relatedItemId: 'ews-item' }, [event])).toBe(event);
});
