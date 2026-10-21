import { expect, it } from 'vitest';
import { declineCounterIcs } from './declineCounter';
it('preserves scheduling identity and recurrence while rejecting the proposal', () => {
  const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:COUNTER', 'BEGIN:VEVENT', 'UID:meeting', 'SEQUENCE:7', 'ORGANIZER:mailto:host@example.test', 'RECURRENCE-ID:20261021T080000Z', 'DTSTART:20261022T080000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const reply = declineCounterIcs(text, 'proposer@example.test');
  for (const line of ['METHOD:DECLINECOUNTER', 'UID:meeting', 'SEQUENCE:7', 'RECURRENCE-ID:20261021T080000Z', 'ATTENDEE:mailto:proposer@example.test', 'ORGANIZER:mailto:host@example.test']) expect(reply).toContain(line);
});
it('fills missing organizer and sequence metadata without inventing a UID', () => {
  const text = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:meeting\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const reply = declineCounterIcs(text, 'proposer@example.test', 'host@example.test');
  expect(reply).toContain('SEQUENCE:0');
  expect(reply).toContain('ORGANIZER:mailto:host@example.test');
  expect(() => declineCounterIcs(text.replace('UID:meeting\r\n', ''), 'proposer@example.test', 'host@example.test')).toThrow();
});
