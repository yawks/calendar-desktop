import { useTranslation } from 'react-i18next';
import { CalendarEvent } from '../../../shared/types';
import { eventMarkers } from '../utils/eventOptions';

export default function EventMarkers({ event }: { event: CalendarEvent }) {
  const { t } = useTranslation();
  const markers = eventMarkers(event);
  const label = [event.eventType, event.sensitivity, event.availability]
    .filter(Boolean).map(value => t(`eventOptions.values.${value}`, { defaultValue: value })).join(', ');
  return markers ? <span role="img" aria-label={label} title={label}>{markers} </span> : null;
}
