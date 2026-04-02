import { invoke } from '@tauri-apps/api/core';
import type { FreeBusyResult } from './googleCalendarApi';

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

  let raw = null as unknown as Record<string, EwsFreeBusySlot[]>;

  try {
    console.log('[FreeBusy] invoking ews_get_free_busy_ews', { emails, start: toGraphDate(timeMin), end: toGraphDate(timeMax) });
    raw = await invoke<Record<string, EwsFreeBusySlot[]>>('ews_get_free_busy_ews', {
      refreshToken,
      emails,
      start: toGraphDate(timeMin),
      end: toGraphDate(timeMax),
      anchorMailbox,
    });
    console.log('[FreeBusy] ews_get_free_busy_ews result', raw);
  } catch (err) {
    console.warn('[FreeBusy] ews_get_free_busy_ews failed, fallback to graph getSchedule', err);
    raw = await invoke<Record<string, EwsFreeBusySlot[]>>('ews_get_free_busy', {
      refreshToken,
      emails,
      start: toGraphDate(timeMin),
      end: toGraphDate(timeMax),
    });
  }

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
