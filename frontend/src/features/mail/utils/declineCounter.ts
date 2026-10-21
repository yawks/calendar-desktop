// @ts-ignore – ical.js has no bundled types for v1.x
import ICAL from 'ical.js';

export function declineCounterIcs(text: string, proposerEmail: string, organizerEmail?: string): string {
  const calendar = new ICAL.Component(ICAL.parse(text));
  const event = calendar.getFirstSubcomponent('vevent');
  if (!event?.getFirstPropertyValue('uid')) throw new Error('Missing scheduling UID');
  calendar.updatePropertyWithValue('method', 'DECLINECOUNTER');
  event.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
  if (!event.hasProperty('sequence')) event.updatePropertyWithValue('sequence', 0);
  if (!event.hasProperty('organizer') && organizerEmail) event.addPropertyWithValue('organizer', `mailto:${organizerEmail}`);
  if (!event.hasProperty('organizer')) throw new Error('Missing scheduling organizer');
  if (!event.getAllProperties('attendee').some((property: any) =>
    String(property.getFirstValue()).toLowerCase() === `mailto:${proposerEmail.toLowerCase()}`)) {
    event.addPropertyWithValue('attendee', `mailto:${proposerEmail}`);
  }
  event.removeAllSubcomponents('valarm');
  event.removeAllProperties('status');
  return calendar.toString();
}
