import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import FreeBusyGrid, { FreeBusyRow } from '../FreeBusyGrid';
import { FreeBusyResult } from '../../utils/googleCalendarApi';

interface FreeBusySectionProps {
  start: string;
  end: string;
  attendees: Array<{ email: string; name?: string }>;
  freeBusyData: Record<string, FreeBusyResult>;
  freeBusyLoading: boolean;
  selfBusySlots: { busy: Array<{ start: Date; end: Date }>; tentative: Array<{ start: Date; end: Date }> };
  ownerEmail?: string;
  onSelectTime: (newStart: Date) => void;
}

export function FreeBusySection({
  start, end, attendees, freeBusyData, freeBusyLoading, selfBusySlots, ownerEmail, onSelectTime
}: FreeBusySectionProps) {
  const { t } = useTranslation();

  const freeBusyWindow = useMemo(() => {
    const d = new Date(start);
    if (Number.isNaN(d.getTime())) return null;
    const ws = new Date(d);
    ws.setHours(7, 0, 0, 0);
    const we = new Date(d);
    we.setHours(21, 0, 0, 0);
    const eventStart = new Date(start);
    const eventEnd = new Date(end);
    if (!Number.isNaN(eventStart.getTime()) && eventStart < ws) ws.setTime(eventStart.getTime());
    if (!Number.isNaN(eventEnd.getTime()) && eventEnd > we) we.setTime(eventEnd.getTime());
    return { windowStart: ws, windowEnd: we };
  }, [start, end]);

  const rows = useMemo((): FreeBusyRow[] => {
    const rows: FreeBusyRow[] = [];
    rows.push({
      email: ownerEmail ?? 'self',
      label: t('freeBusy.me'),
      busy: selfBusySlots.busy,
      tentative: selfBusySlots.tentative,
      unavailable: false,
      isSelf: true,
    });

    for (const attendee of attendees) {
      if (attendee.email === ownerEmail) continue;
      const data = freeBusyData[attendee.email];
      const tentativeSlots = data
        ? ((data as any).tentative ?? [])
        : [];
      rows.push({
        email: attendee.email,
        label: attendee.name ?? attendee.email,
        busy: data?.busy ?? [],
        tentative: tentativeSlots,
        unavailable: data?.unavailable ?? false,
        isSelf: false,
      });
    }
    return rows;
  }, [selfBusySlots.busy, selfBusySlots.tentative, freeBusyData, attendees, ownerEmail, t]);

  if (!freeBusyWindow) return null;

  return (
    <div className="form-row form-row--freebusy">
      <FreeBusyGrid
        rows={rows}
        windowStart={freeBusyWindow.windowStart}
        windowEnd={freeBusyWindow.windowEnd}
        selectedStart={new Date(start)}
        selectedEnd={new Date(end)}
        loading={freeBusyLoading}
        onSelectTime={onSelectTime}
      />
    </div>
  );
}
