import type { MailMessage, MailThread } from '../types';

const DB_NAME = 'offline-mail-cache';
const DB_VERSION = 3;
const THREADS = 'threads';
const MESSAGES = 'messages';
const REMOVALS = 'removals';
const READ_STATES = 'read-states';
type ReadOverlay = { read: boolean; messageIds?: string[] };
type ReadOverlays = Record<string, ReadOverlay>;
let database: IDBDatabase | null = null;

function finishTransaction(
  transaction: IDBTransaction,
  operation: string,
  resolve: () => void,
): void {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => {
    console.error(`[offline-mail] ${operation}:error`, transaction.error);
    resolve();
  };
  transaction.onabort = () => {
    console.error(`[offline-mail] ${operation}:abort`, transaction.error);
    resolve();
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(THREADS)) db.createObjectStore(THREADS);
      if (!db.objectStoreNames.contains(MESSAGES)) db.createObjectStore(MESSAGES);
      if (!db.objectStoreNames.contains(REMOVALS)) db.createObjectStore(REMOVALS);
      if (!db.objectStoreNames.contains(READ_STATES)) db.createObjectStore(READ_STATES);
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

function previewFromMessage(message: MailMessage): string {
  const value = message.body_text || message.body_html || '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function updateThreadFromMessages(thread: MailThread, messages: MailMessage[]): MailThread {
  const latest = [...messages].sort((a, b) =>
    new Date(b.date_time_received).getTime() - new Date(a.date_time_received).getTime()
  )[0];
  if (!latest) return thread;
  return {
    ...thread,
    topic: latest.subject || thread.topic,
    snippet: previewFromMessage(latest),
    last_delivery_time: latest.date_time_received,
    message_count: messages.length,
    unread_count: messages.filter(message => !message.is_read).length,
    from_name: latest.from_name,
    from_email: latest.from_email,
    has_attachments: messages.some(message => message.has_attachments),
  };
}

/** Remove cached conversations and retain tombstones until the source confirms their removal. */
export async function removeOfflineInboxConversations(accountId: string, conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  const db = await openDatabase();
  const removedIds = new Set(conversationIds);
  await new Promise<void>(resolve => {
    const transaction = db.transaction([THREADS, MESSAGES, REMOVALS, READ_STATES], 'readwrite');
    const threadsStore = transaction.objectStore(THREADS);
    const removalsStore = transaction.objectStore(REMOVALS);
    const threadsRequest = threadsStore.get(accountId);
    const removalsRequest = removalsStore.get(accountId);
    let threads: MailThread[] = [];
    let removals: string[] = [];
    let threadsLoaded = false;
    let removalsLoaded = false;
    let applied = false;
    const apply = () => {
      if (applied || !threadsLoaded || !removalsLoaded) return;
      applied = true;
      threadsStore.put(threads.filter(thread => !removedIds.has(thread.conversation_id)), accountId);
      removalsStore.put([...new Set([...removals, ...removedIds])], accountId);
      const readStatesStore = transaction.objectStore(READ_STATES);
      const readStatesRequest = readStatesStore.get(accountId);
      readStatesRequest.onsuccess = () => {
        const overlays = { ...((readStatesRequest.result as ReadOverlays | undefined) ?? {}) };
        for (const conversationId of removedIds) delete overlays[conversationId];
        readStatesStore.put(overlays, accountId);
      };
      for (const conversationId of removedIds) {
        transaction.objectStore(MESSAGES).delete(`${accountId}:${conversationId}`);
      }
    };
    threadsRequest.onsuccess = () => { threads = (threadsRequest.result as MailThread[] | undefined) ?? []; threadsLoaded = true; apply(); };
    removalsRequest.onsuccess = () => { removals = (removalsRequest.result as string[] | undefined) ?? []; removalsLoaded = true; apply(); };
    finishTransaction(transaction, `remove-conversations:${conversationIds.length}`, resolve);
  });
}

/** A move back to Inbox supersedes an older removal tombstone. */
export async function clearOfflineInboxRemovals(accountId: string, conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  const db = await openDatabase();
  const cleared = new Set(conversationIds);
  await new Promise<void>(resolve => {
    const transaction = db.transaction(REMOVALS, 'readwrite');
    const store = transaction.objectStore(REMOVALS);
    const request = store.get(accountId);
    request.onsuccess = () => store.put(
      ((request.result as string[] | undefined) ?? []).filter(id => !cleared.has(id)), accountId,
    );
    finishTransaction(transaction, `clear-removals:${conversationIds.length}`, resolve);
  });
}

export async function updateOfflineInboxReadState(
  accountId: string,
  conversationId: string,
  read: boolean,
  messageIds?: string[],
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>(resolve => {
    const transaction = db.transaction([THREADS, MESSAGES, READ_STATES], 'readwrite');
    const threadsStore = transaction.objectStore(THREADS);
    const messagesStore = transaction.objectStore(MESSAGES);
    const threadsRequest = threadsStore.get(accountId);
    const messagesRequest = messagesStore.get(`${accountId}:${conversationId}`);
    let threads: MailThread[] = [];
    let messages: MailMessage[] = [];
    let threadsLoaded = false;
    let messagesLoaded = false;
    let applied = false;
    const apply = () => {
      if (applied || !threadsLoaded || !messagesLoaded) return;
      applied = true;
      const selected = messageIds ? new Set(messageIds) : null;
      const updatedMessages = messages.map(message =>
        !selected || selected.has(message.item_id) ? { ...message, is_read: read } : message
      );
      if (messages.length > 0) messagesStore.put(updatedMessages, `${accountId}:${conversationId}`);
      const readStatesStore = transaction.objectStore(READ_STATES);
      const readStatesRequest = readStatesStore.get(accountId);
      readStatesRequest.onsuccess = () => readStatesStore.put({
        ...((readStatesRequest.result as ReadOverlays | undefined) ?? {}),
        [conversationId]: { read, messageIds },
      }, accountId);
      threadsStore.put(threads.map(thread => {
        if (thread.conversation_id !== conversationId) return thread;
        if (messages.length > 0) return updateThreadFromMessages(thread, updatedMessages);
        return { ...thread, unread_count: read ? 0 : thread.message_count };
      }), accountId);
    };
    threadsRequest.onsuccess = () => { threads = (threadsRequest.result as MailThread[] | undefined) ?? []; threadsLoaded = true; apply(); };
    messagesRequest.onsuccess = () => { messages = (messagesRequest.result as MailMessage[] | undefined) ?? []; messagesLoaded = true; apply(); };
    finishTransaction(transaction, 'update-read-state', resolve);
  });
}

/** Update a cached conversation after deleting/moving only some of its messages. */
export async function removeOfflineInboxMessages(
  accountId: string,
  conversationId: string,
  messageIds: string[],
): Promise<void> {
  if (messageIds.length === 0) return;
  const db = await openDatabase();
  const removed = new Set(messageIds);
  await new Promise<void>(resolve => {
    const transaction = db.transaction([THREADS, MESSAGES, REMOVALS, READ_STATES], 'readwrite');
    const threadsStore = transaction.objectStore(THREADS);
    const messagesStore = transaction.objectStore(MESSAGES);
    const threadsRequest = threadsStore.get(accountId);
    const messagesRequest = messagesStore.get(`${accountId}:${conversationId}`);
    let threads: MailThread[] = [];
    let messages: MailMessage[] = [];
    let threadsLoaded = false;
    let messagesLoaded = false;
    let applied = false;
    const apply = () => {
      if (applied || !threadsLoaded || !messagesLoaded) return;
      applied = true;
      const remaining = messages.filter(message => !removed.has(message.item_id));
      if (messages.length > 0 && remaining.length === 0) {
        threadsStore.put(threads.filter(thread => thread.conversation_id !== conversationId), accountId);
        messagesStore.delete(`${accountId}:${conversationId}`);
        const removalsStore = transaction.objectStore(REMOVALS);
        const request = removalsStore.get(accountId);
        request.onsuccess = () => removalsStore.put(
          [...new Set([...((request.result as string[] | undefined) ?? []), conversationId])], accountId,
        );
        const readStatesStore = transaction.objectStore(READ_STATES);
        const readStatesRequest = readStatesStore.get(accountId);
        readStatesRequest.onsuccess = () => {
          const overlays = { ...((readStatesRequest.result as ReadOverlays | undefined) ?? {}) };
          delete overlays[conversationId];
          readStatesStore.put(overlays, accountId);
        };
      } else if (messages.length > 0) {
        messagesStore.put(remaining, `${accountId}:${conversationId}`);
        threadsStore.put(threads.map(thread => thread.conversation_id === conversationId
          ? updateThreadFromMessages(thread, remaining) : thread), accountId);
      } else {
        // The synchronizer may have cached the thread envelope while its body fetch failed.
        // Do not create a tombstone without knowing that the deleted message was the last one.
        threadsStore.put(threads.map(thread => thread.conversation_id === conversationId
          ? { ...thread, message_count: Math.max(1, thread.message_count - 1), snippet: '' }
          : thread), accountId);
      }
    };
    threadsRequest.onsuccess = () => { threads = (threadsRequest.result as MailThread[] | undefined) ?? []; threadsLoaded = true; apply(); };
    messagesRequest.onsuccess = () => { messages = (messagesRequest.result as MailMessage[] | undefined) ?? []; messagesLoaded = true; apply(); };
    finishTransaction(transaction, `remove-messages:${messageIds.length}`, resolve);
  });
}

export async function storeOfflineInbox(
  accountId: string,
  threads: MailThread[],
  conversations: Map<string, MailMessage[]>,
): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>(resolve => {
    const transaction = db.transaction([THREADS, MESSAGES, REMOVALS, READ_STATES], 'readwrite');
    const threadsStore = transaction.objectStore(THREADS);
    const removalsStore = transaction.objectStore(REMOVALS);
    const previousRequest = threadsStore.get(accountId);
    const removalsRequest = removalsStore.get(accountId);
    const readStatesStore = transaction.objectStore(READ_STATES);
    const readStatesRequest = readStatesStore.get(accountId);
    let previousThreads: MailThread[] = [];
    let removals: string[] = [];
    let readStates: ReadOverlays = {};
    let previousLoaded = false;
    let removalsLoaded = false;
    let readStatesLoaded = false;
    let applied = false;
    const apply = () => {
      if (applied || !previousLoaded || !removalsLoaded || !readStatesLoaded) return;
      applied = true;
      const fetchedIds = new Set(threads.map(thread => thread.conversation_id));
      const activeRemovals = new Set(removals.filter(id => fetchedIds.has(id)));
      let safeThreads = threads.filter(thread => !activeRemovals.has(thread.conversation_id));
      const effectiveConversations = new Map(conversations);
      const retainedReadStates: ReadOverlays = {};
      const inboxIds = new Set(safeThreads.map(thread => thread.conversation_id));
      for (const [conversationId, overlay] of Object.entries(readStates)) {
        if (!inboxIds.has(conversationId)) continue;
        const messages = effectiveConversations.get(conversationId);
        const selected = overlay.messageIds ? new Set(overlay.messageIds) : null;
        const targets = messages?.filter(message => !selected || selected.has(message.item_id));
        const confirmed = targets && targets.length > 0 && targets.every(message => message.is_read === overlay.read);
        if (confirmed) continue;
        retainedReadStates[conversationId] = overlay;
        if (messages) {
          const updated = messages.map(message =>
            !selected || selected.has(message.item_id) ? { ...message, is_read: overlay.read } : message
          );
          effectiveConversations.set(conversationId, updated);
          safeThreads = safeThreads.map(thread => thread.conversation_id === conversationId
            ? updateThreadFromMessages(thread, updated) : thread);
        } else if (!selected) {
          safeThreads = safeThreads.map(thread => thread.conversation_id === conversationId
            ? { ...thread, unread_count: overlay.read ? 0 : thread.message_count } : thread);
        }
      }
      const retainedIds = new Set(safeThreads.map(thread => thread.conversation_id));
      threadsStore.put(safeThreads, accountId);
      removalsStore.put([...activeRemovals], accountId);
      readStatesStore.put(retainedReadStates, accountId);
      for (const thread of previousThreads) {
        if (!retainedIds.has(thread.conversation_id)) {
          transaction.objectStore(MESSAGES).delete(`${accountId}:${thread.conversation_id}`);
        }
      }
      for (const [conversationId, messages] of effectiveConversations) {
        if (activeRemovals.has(conversationId)) continue;
        const safeMessages = messages.map(message => ({
          ...message,
          attachments: message.attachments.map(({ local_data: _data, ...attachment }) => attachment),
        }));
        transaction.objectStore(MESSAGES).put(safeMessages, `${accountId}:${conversationId}`);
      }
    };
    previousRequest.onsuccess = () => { previousThreads = (previousRequest.result as MailThread[] | undefined) ?? []; previousLoaded = true; apply(); };
    removalsRequest.onsuccess = () => { removals = (removalsRequest.result as string[] | undefined) ?? []; removalsLoaded = true; apply(); };
    readStatesRequest.onsuccess = () => { readStates = (readStatesRequest.result as ReadOverlays | undefined) ?? {}; readStatesLoaded = true; apply(); };
    finishTransaction(transaction, `store-inbox:${threads.length}`, resolve);
  });
}

export async function clearOfflineMailCache(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>(resolve => {
    const transaction = db.transaction([THREADS, MESSAGES, REMOVALS, READ_STATES], 'readwrite');
    transaction.objectStore(THREADS).clear();
    transaction.objectStore(MESSAGES).clear();
    transaction.objectStore(REMOVALS).clear();
    transaction.objectStore(READ_STATES).clear();
    finishTransaction(transaction, 'clear-cache', resolve);
  });
}
