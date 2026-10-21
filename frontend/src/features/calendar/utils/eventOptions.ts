import { CalendarConfig, CalendarEvent, CreateEventPayload } from '../../../shared/types';

export function eventOptions(calendar?: CalendarConfig) {
  switch (calendar?.type) {
    case 'exchange': return { availability: ['Busy', 'Free', 'Tentative', 'OOF', 'WorkingElsewhere'], sensitivity: ['Normal', 'Personal', 'Private', 'Confidential'] };
    case 'google': return { availability: ['opaque', 'transparent'], sensitivity: ['default', 'public', 'private', 'confidential'] };
    case 'nextcloud': return { availability: ['OPAQUE', 'TRANSPARENT'], sensitivity: ['PUBLIC', 'PRIVATE', 'CONFIDENTIAL'] };
    default: return { availability: [], sensitivity: [] };
  }
}

export function eventMarkers(event: Pick<CalendarEvent, 'availability' | 'sensitivity' | 'eventType'>): string {
  const markers = [];
  if (event.availability === 'OOF' || event.eventType === 'outOfOffice') markers.push('🏖');
  if (['private', 'confidential', 'personal'].includes(event.sensitivity?.toLowerCase() ?? '')) markers.push('🔒');
  if (event.eventType === 'focusTime') markers.push('🎯');
  if (event.eventType === 'workingLocation' || event.availability === 'WorkingElsewhere') markers.push('🏠');
  if (event.eventType === 'birthday') markers.push('🎂');
  if (['Free', 'transparent', 'TRANSPARENT'].includes(event.availability ?? '')) markers.push('○');
  return markers.join(' ');
}

export function isFreeEvent(event: Pick<CalendarEvent, 'availability' | 'eventType'>): boolean {
  return event.eventType === 'workingLocation' || ['Free', 'transparent', 'TRANSPARENT'].includes(event.availability ?? '');
}

export function validateEventOptions(payload: CreateEventPayload, provider: CalendarConfig['type']) {
  const options = eventOptions({ type: provider } as CalendarConfig);
  for (const field of ['availability', 'sensitivity'] as const) {
    if (payload[field] !== undefined && !options[field].includes(payload[field]!)) throw new Error(`Invalid ${provider} ${field}`);
  }
}
