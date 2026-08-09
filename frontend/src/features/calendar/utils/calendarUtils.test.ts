import { describe, expect, it } from 'vitest';
import { CalendarConfig, CalendarEvent, Tag } from '../../../shared/types';
import { toTUIEvents } from './calendarUtils';

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
});
