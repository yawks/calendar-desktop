import { describe, expect, it } from 'vitest';
import { CalendarConfig, CalendarEvent, Tag } from '../../../shared/types';
import { getEventColorStyle, toTUIEvents } from './calendarUtils';

const calendar: CalendarConfig = {
  id: 'calendar-1',
  name: 'Calendar',
  url: '',
  color: '#123456',
  visible: true,
};

const tag: Tag = {
  id: 'tag-1',
  name: 'Focus',
  color: '#abcdef',
};

const event: CalendarEvent = {
  id: 'temp-1',
  calendarId: calendar.id,
  title: 'New event',
  start: '2099-01-01T10:00:00.000Z',
  end: '2099-01-01T11:00:00.000Z',
  isAllday: false,
  category: 'time',
  tagId: tag.id,
};

describe('toTUIEvents', () => {
  it('keeps all-day events on their calendar dates and converts the exclusive end', () => {
    const allDayEvent = {
      ...event,
      start: '2026-08-26T00:00:00.000Z',
      end: '2026-08-28T00:00:00.000Z',
      isAllday: true,
      category: 'allday' as const,
    };

    const [result] = toTUIEvents([allDayEvent], [calendar], false, [], {});

    expect(result.start).toBe('2026-08-26');
    expect(result.end).toBe('2026-08-27');
  });

  it('uses local calendar dates for offset all-day timestamps', () => {
    const allDayEvent = {
      ...event,
      start: '2026-09-02T22:00:00.000Z',
      end: '2026-09-04T22:00:00.000Z',
      isAllday: true,
      category: 'allday' as const,
    };

    const [result] = toTUIEvents([allDayEvent], [calendar], false, [], {});

    expect(result.start).toBe('2026-09-03');
    expect(result.end).toBe('2026-09-04');
  });

  it('applies a tag carried by a newly-created event before it has a server ID', () => {
    const [result] = toTUIEvents([event], [calendar], false, [tag], {});

    expect(result.raw.tagColor).toBe(tag.color);
  });

  it('prefers the persisted server mapping once one is available', () => {
    const mappedTag: Tag = { id: 'tag-2', name: 'Meeting', color: '#fedcba' };
    const persistedEvent = { ...event, seriesId: 'server-1' };
    const [result] = toTUIEvents(
      [persistedEvent],
      [calendar],
      false,
      [tag, mappedTag],
      { 'server-1': mappedTag.id },
    );

    expect(result.raw.tagColor).toBe(mappedTag.color);
  });

  it('paints tentative hatching on the full TUI event container', () => {
    const [result] = toTUIEvents(
      [{ ...event, selfRsvpStatus: 'TENTATIVE' }],
      [calendar],
      false,
      [],
      {},
    );

    expect(result.customStyle.backgroundImage).toBe(
      'repeating-linear-gradient(-45deg, rgba(18,52,86,0.3) 0, rgba(18,52,86,0.3) 4px, transparent 4px, transparent 8px)',
    );
    expect(result.raw).not.toHaveProperty('hatchColor');
  });
});

describe('getEventColorStyle', () => {
  it('uses white text on Google blue in dark mode', () => {
    expect(getEventColorStyle('#1a73e8', false, true)).toEqual({
      backgroundColor: '#1a73e8',
      textColor: '#ffffff',
    });
  });

  it('uses white text on vivid red in dark mode', () => {
    expect(getEventColorStyle('#FF4245', false, true)).toEqual({
      backgroundColor: '#FF4245',
      textColor: '#ffffff',
    });
  });

  it.each(['#EA4335', 'rgb(234, 67, 53)'])('uses white text on Google red %s', (color) => {
    expect(getEventColorStyle(color, false, true)).toEqual({
      backgroundColor: color,
      textColor: '#ffffff',
    });
  });

  it('uses dark text on a bright upcoming event in dark mode', () => {
    expect(getEventColorStyle('#e85d3f', false, true)).toEqual({
      backgroundColor: '#e85d3f',
      textColor: '#111315',
    });
  });

  it('keeps a past event coloured while muting it against the dark grid', () => {
    expect(getEventColorStyle('#4b9bd1', true, true)).toEqual({
      backgroundColor: '#2f5a77',
      textColor: '#94bcd7',
    });
  });
});
