import type { FreeBusyResult } from './googleCalendarApi';
import { exchangeCalendarApi } from '../../../shared/api/exchangeCalendarApi';

interface EwsFreeBusySlot {
  start: string;
  end: string;
  busy_type: string; // "Busy" | "Tentative" | "OOF"
}

export async function queryEWSFreeBusy(
  refreshToken: string,
  emails: string[],
  timeMin: Date,
  timeMax: Date,
  anchorMailbox?: string,
): Promise<Record<string, FreeBusyResult>> {
  // Graph API expects UTC ISO without timezone suffix
  function toGraphDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  const raw = await exchangeCalendarApi.freeBusy<Record<string, EwsFreeBusySlot[]>>({
      refreshToken,
      emails,
      start: toGraphDate(timeMin),
      end: toGraphDate(timeMax),
      anchorMailbox,
  });

  const result: Record<string, FreeBusyResult> = {};
  for (const email of emails) {
    const slots = raw[email] ?? [];
    result[email] = {
      busy: slots
        .filter((s) => s.busy_type === 'Busy' || s.busy_type === 'OOF')
        .map((s) => ({ start: new Date(s.start), end: new Date(s.end) })),
      unavailable: false,
    };
    // Tentative slots are exposed separately — reuse busy array with tentative marker via the
    // FreeBusyRow tentative field in CreateEventModal
    (result[email] as FreeBusyResult & { tentative?: Array<{ start: Date; end: Date }> }).tentative =
      slots
        .filter((s) => s.busy_type === 'Tentative')
        .map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
  }
  return result;
}
