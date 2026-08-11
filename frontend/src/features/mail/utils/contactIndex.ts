import Dexie, { type EntityTable } from 'dexie';

export interface ContactObservation {
  email: string;
  displayName?: string;
  kind: 'received' | 'sent' | 'event';
  occurredAt: number;
  eventId: string;
}

export interface IndexedContact {
  email: string; name?: string; receivedCount: number; sentCount: number;
  eventCount: number; lastSeenAt: number;
}

export interface ContactBackfillState { offset: number; completed: boolean }

interface ContactRow extends IndexedContact { key: string; accountId: string; nameQuality: number; firstSeenAt: number }
interface ObservationRow { key: string; contactKey: string; occurredAt: number }
interface BackfillRow extends ContactBackfillState { key: string; updatedAt: number }

class ContactDatabase extends Dexie {
  contacts!: EntityTable<ContactRow, 'key'>;
  observations!: EntityTable<ObservationRow, 'key'>;
  backfill!: EntityTable<BackfillRow, 'key'>;
  constructor() {
    super('courrier-contact-index');
    this.version(1).stores({
      contacts: '&key,accountId,email,lastSeenAt',
      observations: '&key,contactKey,occurredAt',
      backfill: '&key,updatedAt',
    });
  }
}

const db = new ContactDatabase();
const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function usableContactName(name: string | undefined, email: string): string | undefined {
  const value = name?.trim();
  if (!value || value.toLowerCase() === email.trim().toLowerCase() || UUID_NAME.test(value) || value.includes('@')) return undefined;
  return value;
}

function nameQuality(name?: string): number {
  if (!name) return 0;
  return /\s/.test(name) ? 3 : 2;
}

export async function recordContactObservations(accountId: string, observations: ContactObservation[]): Promise<number> {
  if (!accountId || observations.length === 0) return 0;
  let inserted = 0;
  await db.transaction('rw', db.contacts, db.observations, async () => {
    for (const observation of observations) {
      const email = observation.email.trim().toLowerCase();
      if (!email.includes('@') || /\s/.test(email)) continue;
      const contactKey = `${accountId}\0${email}`;
      const observationKey = `${contactKey}\0${observation.kind}\0${observation.eventId}`;
      if (await db.observations.get(observationKey)) continue;
      const current = await db.contacts.get(contactKey);
      const candidateName = usableContactName(observation.displayName, email);
      const candidateQuality = nameQuality(candidateName);
      const row: ContactRow = current ?? {
        key: contactKey, accountId, email, nameQuality: 0, firstSeenAt: observation.occurredAt,
        receivedCount: 0, sentCount: 0, eventCount: 0, lastSeenAt: observation.occurredAt,
      };
      if (candidateQuality > row.nameQuality) { row.name = candidateName; row.nameQuality = candidateQuality; }
      row.firstSeenAt = Math.min(row.firstSeenAt, observation.occurredAt);
      row.lastSeenAt = Math.max(row.lastSeenAt, observation.occurredAt);
      if (observation.kind === 'sent') row.sentCount += 1;
      else if (observation.kind === 'event') row.eventCount += 1;
      else row.receivedCount += 1;
      await db.contacts.put(row);
      await db.observations.add({ key: observationKey, contactKey, occurredAt: observation.occurredAt });
      inserted += 1;
    }
  });
  return inserted;
}

export async function searchContactIndex(accountIds: string[], query = '', maxCount = 200): Promise<IndexedContact[]> {
  if (accountIds.length === 0) return [];
  const allowed = new Set(accountIds);
  const normalizedQuery = query.trim().toLowerCase();
  const cutoff = Math.floor(Date.now() / 1000) - 365 * 86_400;
  const rows = (await db.contacts.toArray()).filter(row => allowed.has(row.accountId) && row.lastSeenAt >= cutoff &&
    (!normalizedQuery || row.email.startsWith(normalizedQuery) || row.name?.toLowerCase().startsWith(normalizedQuery)));
  const merged = new Map<string, IndexedContact>();
  for (const row of rows) {
    const current = merged.get(row.email);
    merged.set(row.email, current ? {
      email: row.email, name: current.name ?? row.name,
      receivedCount: current.receivedCount + row.receivedCount, sentCount: current.sentCount + row.sentCount,
      eventCount: current.eventCount + row.eventCount, lastSeenAt: Math.max(current.lastSeenAt, row.lastSeenAt),
    } : row);
  }
  const now = Math.floor(Date.now() / 1000);
  return [...merged.values()].sort((a, b) => {
    const score = (item: IndexedContact) => item.sentCount * 8 + item.receivedCount * 2 + item.eventCount * 4 + (item.lastSeenAt >= now - 7 * 86_400 ? 20 : item.lastSeenAt >= now - 90 * 86_400 ? 8 : 0);
    return score(b) - score(a) || b.lastSeenAt - a.lastSeenAt;
  }).slice(0, Math.min(maxCount, 1000));
}

export async function cleanupContactIndex(maxAgeDays = 365): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - Math.max(1, maxAgeDays) * 86_400;
  const stale = await db.contacts.where('lastSeenAt').below(cutoff).toArray();
  await db.transaction('rw', db.contacts, db.observations, async () => {
    await db.contacts.bulkDelete(stale.map(row => row.key));
    for (const row of stale) await db.observations.where('contactKey').equals(row.key).delete();
  });
  return stale.length;
}

export async function getContactBackfillState(accountId: string, folder: string): Promise<ContactBackfillState> {
  return await db.backfill.get(`${accountId}\0${folder}`) ?? { offset: 0, completed: false };
}

export async function setContactBackfillState(accountId: string, folder: string, offset: number, completed: boolean): Promise<void> {
  await db.backfill.put({ key: `${accountId}\0${folder}`, offset, completed, updatedAt: Date.now() });
}
