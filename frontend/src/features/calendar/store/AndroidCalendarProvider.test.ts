// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { calendarSnapshots } from './AndroidCalendarProvider';
import type { CalendarConfig, CalendarEvent } from '../../../shared/types';

const sources = ['google', 'exchange', 'nextcloud', 'ics'] as const;
const calendars: CalendarConfig[] = sources.map(type => ({ id: type, type, name: type, url: '', color: '#123456', visible: false, nextcloudPassword: 'secret' }));
const event = (calendarId: string): CalendarEvent => ({ id: `${calendarId}:occurrence`, calendarId, title: 'Meeting', start: '2026-10-19T09:00:00Z', end: '2026-10-19T10:00:00Z', isAllday: false, category: 'time' });

describe('Android calendar publication', () => {
  it.each(sources)('exports readable theme-neutral descriptions for %s', source => {
    const description = '<html><head><style><!--&#xD;body { color: black; }<br/>--></style></head><body>'
      + '<!--&#xD;<br/>Outlook comment--><p style="color:#000000">Bonjour &amp; bienvenue</p>'
      + '<p>Ligne 1<br/>Ligne 2</p><a href="https://teams.microsoft.com/meet/123?p=abc&amp;x=1">Rejoindre Teams</a>'
      + '<script>unwanted()</script></body></html>';
    const original = { ...event(source), description };
    const exported = calendarSnapshots(calendars, [source], { [source]: [original] }, {})[0].events?.[0];
    expect(exported?.description).toBe('Bonjour & bienvenue\n\nLigne 1\nLigne 2\nRejoindre Teams (https://teams.microsoft.com/meet/123?p=abc&x=1)');
    expect(exported?.location).toBe('https://teams.microsoft.com/meet/123?p=abc&x=1');
    expect(original.description).toBe(description);
  });
  it('decodes escaped Outlook HTML and its comments', () => {
    const description = '&lt;!--&amp;#xD;&lt;br/&gt;CSS comment--&gt;&lt;p style=&quot;color:black&quot;&gt;Bonjour&amp;nbsp;!&lt;br/&gt;Suite&lt;/p&gt;';
    const exported = calendarSnapshots(calendars, ['exchange'], { exchange: [{ ...event('exchange'), description }] }, {})[0].events?.[0];
    expect(exported?.description).toBe('Bonjour !\nSuite');
  });
  it('preserves plain-text paragraphs, angle-bracket addresses and comparison signs', () => {
    const description = 'Bonjour <person@example.test>\r\n\r\nLien <https://example.test/join?a=1&b=2>\r\n2 < 3 et 5 > 4';
    const exported = calendarSnapshots(calendars, ['ics'], { ics: [{ ...event('ics'), description }] }, {})[0].events?.[0];
    expect(exported?.description).toBe(description.replace(/\r\n/g, '\n'));
  });
  it('keeps HTML lists and tables readable and discards unsafe link targets', () => {
    const description = '<ul><li>Un</li><li>Deux</li></ul><table><tr><td>A</td><td>B</td></tr></table><a href="javascript:secret()">Texte</a>';
    const text = calendarSnapshots(calendars, ['google'], { google: [{ ...event('google'), description }] }, {})[0].events?.[0].description;
    expect(text).toBe('• Un\n\n• Deux\n\nA B\nTexte');
  });
  it.each(sources)('adds a Teams link from an HTML invitation to the Android location for %s', source => {
    const link = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_test/0?context=%7B%7D&anon=true';
    const original = { ...event(source), location: 'Salle 12', description: `<p><a href="${link.replace('&', '&amp;')}">Rejoindre Teams</a></p>` };
    const payload = calendarSnapshots(calendars, [source], { [source]: [original] }, {});
    expect(payload[0].events?.[0].location).toBe(`Salle 12 — ${link}`);
    expect(original.location).toBe('Salle 12');
  });
  it('supports plain text and dedicated Teams links without duplicating existing locations', () => {
    for (const link of ['https://teams.microsoft.com/meet/123?p=abc', 'https://teams.live.com/meet/123', 'https://teams.cloud.microsoft/meet/123']) {
      const exportedLocation = (data: Partial<CalendarEvent>) => calendarSnapshots(calendars, ['google'], { google: [{ ...event('google'), ...data }] }, {})[0].events?.[0].location;
      expect(exportedLocation({ description: `Rejoindre : <${link}>` })).toBe(link);
      expect(exportedLocation({ meetUrl: link })).toBe(link);
      expect(exportedLocation({ location: `Bureau — ${link}`, description: link })).toBe(`Bureau — ${link}`);
      expect(exportedLocation({ description: `Rejoindre (${link}).` })).toBe(link);
    }
  });
  it('keeps locations unchanged when there is no Teams meeting link', () => {
    for (const description of ['https://teams.microsoft.com/meetingOptions/?id=123', 'https://teams.microsoft.com.evil.test/meet/123', 'https://meet.google.com/abc', 'https://example.test/meet/123']) {
      const payload = calendarSnapshots(calendars, ['ics'], { ics: [{ ...event('ics'), location: 'Salle 12', description }] }, {});
      expect(payload[0].events?.[0].location).toBe('Salle 12');
    }
  });
  it.each(sources)('preserves the viewer RSVP independently of guests for %s', source => {
    for (const selfRsvpStatus of ['ACCEPTED', 'DECLINED', 'TENTATIVE', 'NEEDS-ACTION'] as const) {
      const payload = calendarSnapshots(calendars, [source], { [source]: [{
        ...event(source), selfRsvpStatus,
        attendees: [{ name: 'Other guest', email: 'other@example.test', status: 'ACCEPTED' }],
      }] }, {});
      expect(payload[0].events?.[0].selfRsvpStatus).toBe(selfRsvpStatus);
    }
  });
  it('uses the calendar owner response when the provider omits an explicit self RSVP', () => {
    const owned = [{ ...calendars[0], ownerEmail: 'ME@example.test' }];
    const payload = calendarSnapshots(owned, ['google'], { google: [{ ...event('google'), attendees: [
      { name: 'Me', email: 'me@example.test', status: 'ACCEPTED', isOrganizer: true },
      { name: 'Guest', email: 'guest@example.test', status: 'NEEDS-ACTION' },
    ] }] }, {});
    expect(payload[0].events?.[0].selfRsvpStatus).toBe('ACCEPTED');
    expect(payload[0].ownerEmail).toBe('ME@example.test');
    const unknown = calendarSnapshots(calendars, ['google'], { google: [event('google')] }, {});
    expect(unknown[0].events?.[0].selfRsvpStatus).toBeUndefined();
  });
  it.each(sources)('exports guests and organizer for %s', source => {
    const attendees = [
      { name: 'Organizer', email: 'host@example.test', status: 'ACCEPTED' as const, isOrganizer: true },
      { name: 'Guest', email: 'guest@example.test', status: 'TENTATIVE' as const },
    ];
    const payload = calendarSnapshots(calendars, [source], { [source]: [{ ...event(source), attendees }] }, {});
    expect(payload[0].events?.[0].attendees).toEqual(attendees);
  });
  it('exports every supported source independently of its visibility, without credentials', () => {
    const snapshots = Object.fromEntries(sources.map(id => [id, [event(id)]]));
    const payload = calendarSnapshots(calendars, [...sources], snapshots, {});
    expect(payload.map(cal => cal.id)).toEqual(sources);
    expect(payload.every(cal => cal.events?.length === 1)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('secret');
  });
  it('distinguishes successful empty snapshots from failed and not-yet-loaded calendars', () => {
    const payload = calendarSnapshots(calendars, [...sources], { google: [], exchange: [] }, { exchange: 'offline' });
    expect(payload[0].events).toEqual([]);
    expect(payload[1].events).toBeUndefined();
    expect(payload[2].events).toBeUndefined();
  });
  it('excludes unselected or removed calendars and cancelled occurrences', () => {
    const payload = calendarSnapshots(calendars, ['google', 'removed'], { google: [event('google'), { ...event('google'), id: 'cancelled', isCancelled: true }] }, {});
    expect(payload).toHaveLength(1);
    expect(payload[0].events?.map(row => row.id)).toEqual(['google:occurrence']);
    expect(calendarSnapshots(calendars, [], {}, {})).toEqual([]);
  });
});
