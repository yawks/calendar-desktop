import type { MailMessage, MailThread } from '../types';

const DB_NAME = 'offline-mail-cache';
const DB_VERSION = 1;
const THREADS = 'threads';
const MESSAGES = 'messages';
let database: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(THREADS)) db.createObjectStore(THREADS);
      if (!db.objectStoreNames.contains(MESSAGES)) db.createObjectStore(MESSAGES);
    };
    request.onsuccess = () => { database = request.result; resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

function requestValue<T>(store: string, key: string): Promise<T | null> {
  return openDatabase().then(db => new Promise(resolve => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => resolve(null);
  }));
}

export const getOfflineInboxThreads = (accountId: string) => requestValue<MailThread[]>(THREADS, accountId);
export const getOfflineConversation = (accountId: string, conversationId: string) =>
  requestValue<MailMessage[]>(MESSAGES, `${accountId}:${conversationId}`);

export async function storeOfflineInbox(
  accountId: string,
  threads: MailThread[],
  conversations: Map<string, MailMessage[]>,
): Promise<void> {
  const db = await openDatabase();
  const previousThreads = await getOfflineInboxThreads(accountId) ?? [];
  const retainedIds = new Set(threads.map(thread => thread.conversation_id));
  await new Promise<void>(resolve => {
    const transaction = db.transaction([THREADS, MESSAGES], 'readwrite');
    transaction.objectStore(THREADS).put(threads, accountId);
    for (const thread of previousThreads) {
      if (!retainedIds.has(thread.conversation_id)) {
        transaction.objectStore(MESSAGES).delete(`${accountId}:${thread.conversation_id}`);
      }
    }
    for (const [conversationId, messages] of conversations) {
      // Attachment metadata is useful offline; binary data is deliberately excluded.
      const safeMessages = messages.map(message => ({
        ...message,
        attachments: message.attachments.map(({ local_data: _data, ...attachment }) => attachment),
      }));
      transaction.objectStore(MESSAGES).put(safeMessages, `${accountId}:${conversationId}`);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
}

export async function clearOfflineMailCache(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>(resolve => {
    const transaction = db.transaction([THREADS, MESSAGES], 'readwrite');
    transaction.objectStore(THREADS).clear();
    transaction.objectStore(MESSAGES).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
}
